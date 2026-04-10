import ffmpeg from "fluent-ffmpeg";
import { getFfmpegPath } from "../../lib/ffmpegpath.js";
ffmpeg.setFfmpegPath(getFfmpegPath());
import {
  createWriteStream,
  statSync,
  unlinkSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { minioClient } from "../../storage/minio.js";
import { db } from "../../db/client.js";
import { cuts } from "../../db/schema.js";
import { env } from "../../config/env.js";
import { AppError } from "../../shared/errors.js";
import { generateAss } from "../../lib/subtitle.js";
import type { RenderRequest, RenderResponse } from "./render.schema.js";
import type { SubtitleStyle } from "../../lib/subtitle.js";

// ── MinIO helpers ─────────────────────────────────────────────────────────────

async function downloadFromMinio(
  storageKey: string,
  destPath: string
): Promise<void> {
  try {
    const stream = await minioClient.getObject(env.MINIO_BUCKET, storageKey);
    await pipeline(stream, createWriteStream(destPath));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new AppError(502, `Failed to download ${storageKey} from storage: ${msg}`);
  }
}

async function uploadToMinio(
  filePath: string,
  storageKey: string
): Promise<number> {
  const { size } = statSync(filePath);
  const { createReadStream } = await import("node:fs");
  try {
    await minioClient.putObject(
      env.MINIO_BUCKET,
      storageKey,
      createReadStream(filePath),
      size,
      { "Content-Type": "video/mp4" }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new AppError(502, `Failed to upload rendered clip to storage: ${msg}`);
  }
  return size;
}

async function buildPresignedUrl(storageKey: string): Promise<string> {
  try {
    return await minioClient.presignedGetObject(
      env.MINIO_BUCKET,
      storageKey,
      24 * 60 * 60
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new AppError(502, `Failed to generate presigned URL: ${msg}`);
  }
}

// ── ffmpeg pipeline ───────────────────────────────────────────────────────────

/**
 * Runs the full rendering pipeline using the "blur background" technique:
 *   1. Background: video scaled to fill 9:16, center-cropped, heavily blurred
 *   2. Foreground: video scaled to fit inside 9:16 (preserves full frame / no cropping)
 *   3. Foreground overlaid centered on background
 *   4. Optionally burn ASS subtitles
 *   5. Encode to H.264/AAC MP4 optimised for streaming
 *
 * This avoids the hard center-crop that cuts off people at the edges of frame.
 */
function render(
  inputPath: string,
  subtitlePath: string | null,
  outputPath: string,
  width: number,
  height: number,
  log: (msg: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    // ── Complex filtergraph ─────────────────────────────────────────────────
    //
    //  [bg_in] → scale to fill portrait → center-crop → heavy blur → [bg]
    //  [fg_in] → scale to fit portrait (no crop)                   → [fg]
    //  [bg][fg] → overlay centered                                 → [composed]
    //  [composed] → optional subtitle burn                         → [out]

    const complexFilters: string[] = [
      // Split input into two identical streams
      `[0:v]split[bg_in][fg_in]`,

      // Background: fill the 9:16 canvas, crop to exact size, blur
      `[bg_in]scale=${width}:${height}:force_original_aspect_ratio=increase,` +
        `crop=${width}:${height},` +
        `boxblur=luma_radius=25:luma_power=2[bg]`,

      // Foreground: scale to fit inside portrait frame — full video visible
      `[fg_in]scale=${width}:${height}:force_original_aspect_ratio=decrease[fg]`,
    ];

    // Overlay + optional subtitles
    const overlayBase = `[bg][fg]overlay=(W-overlay_w)/2:(H-overlay_h)/2`;
    if (subtitlePath) {
      const escapedSubPath = subtitlePath
        .replace(/\\/g, "\\\\")
        .replace(/:/g, "\\:");
      complexFilters.push(`${overlayBase},subtitles='${escapedSubPath}'[out]`);
    } else {
      complexFilters.push(`${overlayBase}[out]`);
    }

    ffmpeg(inputPath)
      .complexFilter(complexFilters, "out")
      // complexFilter disables automatic stream mapping — must map audio explicitly
      .addOutputOption("-map 0:a?")
      // H.264, fast preset, CRF 23 → good quality for social media at ~2–4 Mbps
      .videoCodec("libx264")
      .addOutputOption("-preset fast")
      .addOutputOption("-crf 23")
      .addOutputOption("-pix_fmt yuv420p") // iOS/Android compatibility
      // AAC stereo, 128 kbps
      .audioCodec("aac")
      .audioBitrate("128k")
      // Optimise for streaming — move moov atom to front
      .addOutputOption("-movflags +faststart")
      .on("start", (cmd) => log(`[ffmpeg] ${cmd}`))
      .on("stderr", (line) => log(`[ffmpeg] ${line}`))
      .on("end", () => resolve())
      .on("error", (err) =>
        reject(new AppError(502, `ffmpeg failed: ${err.message}`))
      )
      .save(outputPath);
  });
}

// ── Main service function ─────────────────────────────────────────────────────

export async function renderClip(
  request: RenderRequest,
  log: (msg: string) => void = () => {}
): Promise<RenderResponse> {
  const {
    cutId,
    storageKey,
    tempo_inicial,
    tempo_final,
    segments,
    subtitleStyle,
    noSubtitles,
    resolution,
  } = request;

  const { width, height } = resolution;
  const durationMs = tempo_final - tempo_inicial;

  // Derive the output key: rendered/ prefix, same base name with _9x16 suffix
  const base = storageKey
    .replace(/^cuts\//, "")
    .replace(/\.mp4$/, "");
  const outputKey = `rendered/${base}_${width}x${height}.mp4`;

  // Temp file paths
  const tmpDir = join(tmpdir(), "api-cuts");
  mkdirSync(tmpDir, { recursive: true });
  const id = nanoid(12);
  const rawPath = join(tmpDir, `${id}_raw.mp4`);
  const assPath = join(tmpDir, `${id}.ass`);
  const outPath = join(tmpDir, `${id}_out.mp4`);

  const startedAt = Date.now();

  try {
    // 1. Download the raw cut from MinIO
    log(`[render] Downloading ${storageKey} from MinIO…`);
    await downloadFromMinio(storageKey, rawPath);

    // 2. Generate ASS subtitle file (skip when noSubtitles is true)
    let effectiveAssPath: string | null = null;
    if (!noSubtitles) {
      log(`[render] Generating subtitles for ${segments.length} segment(s)…`);
      const assContent = generateAss(
        segments,
        tempo_inicial,
        tempo_final,
        width,
        height,
        subtitleStyle as SubtitleStyle
      );
      writeFileSync(assPath, assContent, "utf8");
      effectiveAssPath = assPath;
    }

    // 3. Run ffmpeg rendering pipeline
    const label = noSubtitles ? "without subtitles" : "with burned subtitles";
    log(`[render] Encoding ${width}×${height} ${label}…`);
    await render(rawPath, effectiveAssPath, outPath, width, height, log);

    // 4. Upload rendered clip to MinIO
    log(`[render] Uploading rendered clip to ${outputKey}…`);
    const fileSizeBytes = await uploadToMinio(outPath, outputKey);

    // 5. Generate presigned URL
    const presignedUrl = await buildPresignedUrl(outputKey);
    const processingTimeMs = Date.now() - startedAt;

    // 6. Update DB record if a cutId was provided
    if (cutId) {
      db.update(cuts)
        .set({ renderedStorageKey: outputKey, status: "rendered" })
        .where(eq(cuts.id, cutId))
        .run();
    }

    log(
      `[render] Done in ${(processingTimeMs / 1000).toFixed(1)}s — ` +
        `${(fileSizeBytes / 1024 / 1024).toFixed(2)} MB`
    );

    return {
      storageKey: outputKey,
      presignedUrl,
      resolution: `${width}x${height}`,
      durationMs,
      fileSizeBytes,
      processingTimeMs,
    };
  } finally {
    // Always remove temp files regardless of success/failure
    for (const p of [rawPath, assPath, outPath]) {
      if (existsSync(p)) {
        try { unlinkSync(p); } catch { /* ignore */ }
      }
    }
  }
}
