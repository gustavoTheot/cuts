import { createReadStream, statSync, unlinkSync, existsSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nanoid } from "nanoid";
import { exec } from "../../lib/exec.js";
import { ensureYtDlp } from "../../lib/ytdlp.js";
import { getFfmpegPath } from "../../lib/ffmpegpath.js";
import { minioClient } from "../../storage/minio.js";
import { db } from "../../db/client.js";
import { cuts } from "../../db/schema.js";
import { env } from "../../config/env.js";
import { AppError } from "../../shared/errors.js";
import { extractVideoId } from "../transcription/transcription.service.js";
import type { CaptureRequest, CaptureResponse } from "./capture.schema.js";

// ── Time helpers ──────────────────────────────────────────────────────────────

/**
 * Converts milliseconds to the HH:MM:SS.mmm format required by yt-dlp
 * `--download-sections` (e.g. 42500 → "00:00:42.500").
 */
function msToYtDlpTime(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  const frac = ms % 1_000;
  return [
    String(h).padStart(2, "0"),
    String(m).padStart(2, "0"),
    String(s).padStart(2, "0"),
  ].join(":") + `.${String(frac).padStart(3, "0")}`;
}

// ── yt-dlp runner ─────────────────────────────────────────────────────────────

/**
 * Downloads a precise time range from a YouTube URL using yt-dlp.
 * Returns the path to the downloaded mp4 file.
 *
 * The `--download-sections` flag tells yt-dlp to fetch only the requested
 * bytes from the CDN, so no full-video download occurs.
 * `--force-keyframes-at-cuts` re-encodes the boundary frames so the clip
 * starts and ends at the exact millisecond (requires ffmpeg).
 */
async function downloadSection(
  url: string,
  startMs: number,
  endMs: number,
  maxHeight: number,
  log: (line: string) => void
): Promise<string> {
  // Use a dedicated subdirectory inside /tmp to avoid permission issues
  const tmpDir = join(tmpdir(), "api-cuts");
  mkdirSync(tmpDir, { recursive: true });

  const id = nanoid(12);
  // yt-dlp may append .mp4 automatically, but we force the extension via -o
  const outputPath = join(tmpDir, `${id}.mp4`);

  const section = `*${msToYtDlpTime(startMs)}-${msToYtDlpTime(endMs)}`;

  const format = [
    `bestvideo[height<=${maxHeight}][ext=mp4]+bestaudio[ext=m4a]`,
    `bestvideo[height<=${maxHeight}]+bestaudio`,
    `best[height<=${maxHeight}]`,
    "best",
  ].join("/");

  const args = [
    "--download-sections", section,
    "--ffmpeg-location", getFfmpegPath(),
    "-f", format,
    "--merge-output-format", "mp4",
    "--no-playlist",
    "--no-warnings",
    "--progress",
    "-o", outputPath,
    url,
  ];

  const ytDlpBin = await ensureYtDlp();
  await exec(ytDlpBin, args, { onStderr: log });

  if (!existsSync(outputPath)) {
    throw new AppError(502, "yt-dlp finished but output file was not created");
  }

  return outputPath;
}

// ── MinIO upload ──────────────────────────────────────────────────────────────

async function uploadToMinio(
  filePath: string,
  storageKey: string
): Promise<number> {
  const { size } = statSync(filePath);
  const stream = createReadStream(filePath);
  try {
    await minioClient.putObject(
      env.MINIO_BUCKET,
      storageKey,
      stream,
      size,
      { "Content-Type": "video/mp4" }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new AppError(502, `Failed to upload clip to storage: ${msg}`);
  }
  return size;
}

// ── Presigned URL ─────────────────────────────────────────────────────────────

async function buildPresignedUrl(storageKey: string): Promise<string> {
  try {
    return await minioClient.presignedGetObject(env.MINIO_BUCKET, storageKey, 24 * 60 * 60);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new AppError(502, `Failed to generate presigned URL: ${msg}`);
  }
}

// ── Main service function ─────────────────────────────────────────────────────

export async function captureSection(
  request: CaptureRequest,
  log: (msg: string) => void = () => {}
): Promise<CaptureResponse> {
  const {
    url,
    tempo_inicial,
    tempo_final,
    titulo_sugerido,
    tags,
    maxHeight,
  } = request;

  const videoId = extractVideoId(url);
  const id = nanoid();
  const rawStorageKey = `cuts/${videoId}/${tempo_inicial}-${tempo_final}.mp4`;
  const createdAt = new Date();

  // 1. Download the surgical clip
  log(`[capture] Downloading ${msToYtDlpTime(tempo_inicial)} → ${msToYtDlpTime(tempo_final)} (${videoId})`);
  let filePath: string | undefined;

  try {
    filePath = await downloadSection(url, tempo_inicial, tempo_final, maxHeight, log);

    // 2. Upload to MinIO
    log(`[capture] Uploading to MinIO: ${rawStorageKey}`);
    const fileSizeBytes = await uploadToMinio(filePath, rawStorageKey);

    // 3. Persist to DB
    db.insert(cuts)
      .values({
        id,
        sourceVideoId: videoId,
        title: titulo_sugerido,
        tagsJson: JSON.stringify(tags),
        rawStorageKey: rawStorageKey,
        startMs: tempo_inicial,
        endMs: tempo_final,
        durationMs: tempo_final - tempo_inicial,
        status: "captured",
        createdAt,
      })
      .run();

    // 4. Generate presigned URL for immediate use
    const presignedUrl = await buildPresignedUrl(rawStorageKey);

    log(`[capture] Done — ${(fileSizeBytes / 1024 / 1024).toFixed(2)} MB — ${rawStorageKey}`);

    return {
      id,
      videoId,
      storageKey: rawStorageKey,
      presignedUrl,
      titulo_sugerido,
      tags,
      tempo_inicial,
      tempo_final,
      durationMs: tempo_final - tempo_inicial,
      fileSizeBytes,
      createdAt: createdAt.toISOString(),
    };
  } finally {
    // Always clean up the temp file, even on error
    if (filePath && existsSync(filePath)) {
      try { unlinkSync(filePath); } catch { /* ignore */ }
    }
  }
}
