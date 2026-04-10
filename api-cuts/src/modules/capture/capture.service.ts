import { spawn } from "node:child_process";
import { createReadStream, statSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nanoid } from "nanoid";
import { ensureYtDlp } from "../../lib/ytdlp.js";
import { getFfmpegPath } from "../../lib/ffmpegpath.js";
import { minioClient } from "../../storage/minio.js";
import { db } from "../../db/client.js";
import { cuts } from "../../db/schema.js";
import { env } from "../../config/env.js";
import { AppError } from "../../shared/errors.js";
import { extractVideoId } from "../transcription/transcription.service.js";
import type { CaptureRequest, CaptureResponse } from "./capture.schema.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type CaptureEvent =
  | { kind: "progress"; percent: number }
  | { kind: "done"; result: CaptureResponse };

// ── Time helpers ──────────────────────────────────────────────────────────────

function msToYtDlpTime(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  const frac = ms % 1_000;
  return [String(h).padStart(2, "0"), String(m).padStart(2, "0"), String(s).padStart(2, "0")].join(":") +
    `.${String(frac).padStart(3, "0")}`;
}

// ── yt-dlp download (async generator — yields download %) ────────────────────

async function* downloadSection(
  url: string,
  startMs: number,
  endMs: number,
  maxHeight: number,
  outputPath: string,
): AsyncGenerator<number> {
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
    "--newline",          // one progress line per line (easier to parse)
    "-o", outputPath,
    url,
  ];

  const ytDlpBin = await ensureYtDlp();
  const proc = spawn(ytDlpBin, args, { stdio: ["ignore", "ignore", "pipe"], detached: true });

  let lastPercent = 0;

  // Node.js streams are async iterables — read stderr chunk by chunk
  for await (const chunk of proc.stderr as AsyncIterable<Buffer>) {
    const text = chunk.toString();
    // yt-dlp with --newline: "[download]  72.3% of ..."
    const match = /\[download\]\s+([\d.]+)%/.exec(text);
    if (match) {
      const pct = Math.min(Math.round(parseFloat(match[1])), 99);
      if (pct > lastPercent) {
        lastPercent = pct;
        yield pct;
      }
    }
  }

  // Wait for process exit
  await new Promise<void>((resolve, reject) => {
    proc.on("close", (code, signal) => {
      if (code === 0) resolve();
      else reject(new AppError(502, `yt-dlp exited with ${signal ?? `code ${code}`}`));
    });
    proc.on("error", (err) => reject(new AppError(502, `Failed to spawn yt-dlp: ${err.message}`)));
  });

  if (!existsSync(outputPath)) {
    throw new AppError(502, "yt-dlp finished but output file was not created");
  }
}

// ── MinIO helpers ─────────────────────────────────────────────────────────────

async function uploadToMinio(filePath: string, storageKey: string): Promise<number> {
  const { size } = statSync(filePath);
  const stream = createReadStream(filePath);
  try {
    await minioClient.putObject(env.MINIO_BUCKET, storageKey, stream, size, { "Content-Type": "video/mp4" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new AppError(502, `Failed to upload clip to storage: ${msg}`);
  }
  return size;
}

async function buildPresignedUrl(storageKey: string): Promise<string> {
  try {
    return await minioClient.presignedGetObject(env.MINIO_BUCKET, storageKey, 24 * 60 * 60);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new AppError(502, `Failed to generate presigned URL: ${msg}`);
  }
}

// ── Main (AsyncGenerator) ─────────────────────────────────────────────────────

/**
 * Downloads a precise clip from YouTube and uploads it to MinIO.
 * Yields { kind: 'progress', percent } during download, then
 * yields { kind: 'done', result } on completion.
 */
export async function* captureSection(
  request: CaptureRequest,
  log: (msg: string) => void = () => {},
): AsyncGenerator<CaptureEvent> {
  const { url, tempo_inicial, tempo_final, titulo_sugerido, tags, hashtags, maxHeight } = request;

  const videoId = extractVideoId(url);
  const id = nanoid();
  const rawStorageKey = `cuts/${videoId}/${tempo_inicial}-${tempo_final}.mp4`;
  const createdAt = new Date();

  const tmpDir = join(tmpdir(), "api-cuts");
  mkdirSync(tmpDir, { recursive: true });
  const outputPath = join(tmpDir, `${nanoid(12)}.mp4`);

  log(`[capture] Downloading ${msToYtDlpTime(tempo_inicial)} → ${msToYtDlpTime(tempo_final)} (${videoId})`);

  try {
    // ── Download with live progress ───────────────────────────────────────────
    for await (const percent of downloadSection(url, tempo_inicial, tempo_final, maxHeight, outputPath)) {
      yield { kind: "progress", percent };
    }

    // ── Upload to MinIO ───────────────────────────────────────────────────────
    log(`[capture] Uploading to MinIO: ${rawStorageKey}`);
    const fileSizeBytes = await uploadToMinio(outputPath, rawStorageKey);

    // ── Persist to DB ─────────────────────────────────────────────────────────
    db.insert(cuts).values({
      id,
      sourceVideoId: videoId,
      title: titulo_sugerido,
      tagsJson: JSON.stringify(tags),
      hashtagsJson: JSON.stringify(hashtags ?? []),
      rawStorageKey,
      startMs: tempo_inicial,
      endMs: tempo_final,
      durationMs: tempo_final - tempo_inicial,
      status: "captured",
      createdAt,
    }).run();

    const presignedUrl = await buildPresignedUrl(rawStorageKey);
    log(`[capture] Done — ${(fileSizeBytes / 1024 / 1024).toFixed(2)} MB`);

    yield {
      kind: "done",
      result: {
        id, videoId, storageKey: rawStorageKey, presignedUrl,
        titulo_sugerido, tags,
        tempo_inicial, tempo_final,
        durationMs: tempo_final - tempo_inicial,
        fileSizeBytes,
        createdAt: createdAt.toISOString(),
      },
    };
  } finally {
    if (existsSync(outputPath)) {
      try { unlinkSync(outputPath); } catch { /* ignore */ }
    }
  }
}
