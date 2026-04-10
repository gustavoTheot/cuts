import ffmpeg from "fluent-ffmpeg";
import { getFfmpegPath } from "../../lib/ffmpegpath.js";
ffmpeg.setFfmpegPath(getFfmpegPath());
import { spawn } from "node:child_process";
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

// ── Types ─────────────────────────────────────────────────────────────────────

export type RenderEvent =
  | { kind: "progress"; percent: number }
  | { kind: "done"; result: RenderResponse };

// ── MinIO helpers ─────────────────────────────────────────────────────────────

async function downloadFromMinio(storageKey: string, destPath: string): Promise<void> {
  try {
    const stream = await minioClient.getObject(env.MINIO_BUCKET, storageKey);
    await pipeline(stream, createWriteStream(destPath));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new AppError(502, `Failed to download ${storageKey} from storage: ${msg}`);
  }
}

async function uploadToMinio(filePath: string, storageKey: string): Promise<number> {
  const { size } = statSync(filePath);
  const { createReadStream } = await import("node:fs");
  try {
    await minioClient.putObject(
      env.MINIO_BUCKET, storageKey, createReadStream(filePath), size,
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
    return await minioClient.presignedGetObject(env.MINIO_BUCKET, storageKey, 24 * 60 * 60);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new AppError(502, `Failed to generate presigned URL: ${msg}`);
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const RENDER_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

// ── VideoToolbox detection ────────────────────────────────────────────────────

let _hasVTB: boolean | null = null;

async function hasVideoToolbox(): Promise<boolean> {
  if (_hasVTB !== null) return _hasVTB;
  return new Promise((resolve) => {
    const proc = spawn(getFfmpegPath(), ["-encoders"], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    proc.stdout.on("data", (d: Buffer) => (out += d.toString()));
    proc.on("close", () => { _hasVTB = out.includes("h264_videotoolbox"); resolve(_hasVTB!); });
    proc.on("error", () => { _hasVTB = false; resolve(false); });
  });
}

// ── ffmpeg pipeline (AsyncGenerator — yields render %) ───────────────────────

/**
 * Blur-background portrait render:
 *   bg = fill+crop+blur, fg = fit (no crop), overlay centered, optional ASS subs
 * Tries h264_videotoolbox (GPU) first, falls back to libx264 ultrafast.
 * Yields 0–100 progress percent during encoding.
 */
async function* renderWithProgress(
  inputPath: string,
  subtitlePath: string | null,
  outputPath: string,
  width: number,
  height: number,
  log: (msg: string) => void,
): AsyncGenerator<number> {
  const complexFilters: string[] = [
    `[0:v]split[bg_in][fg_in]`,
    // Background: fill+crop+blur (luma_power=1 is faster than 2, still looks good)
    `[bg_in]scale=${width}:${height}:force_original_aspect_ratio=increase,` +
      `crop=${width}:${height},boxblur=luma_radius=20:luma_power=1[bg]`,
    // Foreground: fit inside portrait (no crop, full frame visible)
    `[fg_in]scale=${width}:${height}:force_original_aspect_ratio=decrease[fg]`,
  ];

  const overlayBase = `[bg][fg]overlay=(W-overlay_w)/2:(H-overlay_h)/2`;
  if (subtitlePath) {
    const escapedSubPath = subtitlePath.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
    complexFilters.push(`${overlayBase},subtitles='${escapedSubPath}'[out]`);
  } else {
    complexFilters.push(`${overlayBase}[out]`);
  }

  const vtb = await hasVideoToolbox();
  log(`[render] Using ${vtb ? "h264_videotoolbox (GPU)" : "libx264 ultrafast"}`);

  // Queue to bridge callback events → async generator
  type Msg = { type: "progress"; pct: number } | { type: "end" } | { type: "error"; err: Error };
  const queue: Msg[] = [];
  const waiters: ((m: Msg) => void)[] = [];
  const emit = (m: Msg) => {
    const w = waiters.shift();
    if (w) w(m);
    else queue.push(m);
  };
  const next = () => new Promise<Msg>((r) => {
    const q = queue.shift();
    if (q) r(q);
    else waiters.push(r);
  });

  const cmd = ffmpeg(inputPath)
    .complexFilter(complexFilters, "out")
    .addOutputOption("-map 0:a?")
    .addOutputOption("-threads 0"); // use all CPU cores

  if (vtb) {
    // Hardware encoder: no CRF, use bitrate-based quality
    cmd
      .videoCodec("h264_videotoolbox")
      .addOutputOption("-b:v 4000k")
      .addOutputOption("-maxrate 6000k");
  } else {
    cmd
      .videoCodec("libx264")
      .addOutputOption("-preset ultrafast")
      .addOutputOption("-crf 23");
  }

  const renderTimer = setTimeout(() => {
    emit({ type: "error", err: new Error(`ffmpeg render timed out after ${RENDER_TIMEOUT_MS / 60_000} minutes`) });
    try { cmd.kill("SIGKILL"); } catch { /* already done */ }
  }, RENDER_TIMEOUT_MS);

  cmd
    .audioCodec("aac")
    .audioBitrate("128k")
    .addOutputOption("-pix_fmt yuv420p")
    .addOutputOption("-movflags +faststart")
    .on("start", (c) => log(`[ffmpeg] ${c}`))
    .on("stderr", (line) => log(`[ffmpeg] ${line}`))
    .on("progress", ({ percent }) => emit({ type: "progress", pct: Math.min(Math.round(percent ?? 0), 99) }))
    .on("end", () => { clearTimeout(renderTimer); emit({ type: "end" }); })
    .on("error", (err) => { clearTimeout(renderTimer); emit({ type: "error", err }); })
    .save(outputPath);

  while (true) {
    const msg = await next();
    if (msg.type === "progress") yield msg.pct;
    else if (msg.type === "end") return;
    else throw new AppError(502, `ffmpeg failed: ${msg.err.message}`);
  }
}

// ── Main (AsyncGenerator) ─────────────────────────────────────────────────────

/**
 * Full rendering pipeline: download raw → generate ASS → ffmpeg encode → upload.
 * Yields { kind: 'progress', percent } during encoding, then
 * yields { kind: 'done', result } on completion.
 */
export async function* renderClip(
  request: RenderRequest,
  log: (msg: string) => void = () => {},
): AsyncGenerator<RenderEvent> {
  const { cutId, storageKey, tempo_inicial, tempo_final, segments, subtitleStyle, noSubtitles, resolution } = request;
  const { width, height } = resolution;
  const durationMs = tempo_final - tempo_inicial;

  const base = storageKey.replace(/^cuts\//, "").replace(/\.mp4$/, "");
  const outputKey = `rendered/${base}_${width}x${height}.mp4`;

  const tmpDir = join(tmpdir(), "api-cuts");
  mkdirSync(tmpDir, { recursive: true });
  const id = nanoid(12);
  const rawPath = join(tmpDir, `${id}_raw.mp4`);
  const assPath = join(tmpDir, `${id}.ass`);
  const outPath = join(tmpDir, `${id}_out.mp4`);
  const startedAt = Date.now();

  try {
    // 1. Download raw clip
    log(`[render] Downloading ${storageKey}…`);
    await downloadFromMinio(storageKey, rawPath);

    // 2. Generate ASS subtitles
    let effectiveAssPath: string | null = null;
    if (!noSubtitles) {
      log(`[render] Generating subtitles for ${segments.length} segment(s)…`);
      const assContent = generateAss(segments, tempo_inicial, tempo_final, width, height, subtitleStyle as SubtitleStyle);
      writeFileSync(assPath, assContent, "utf8");
      effectiveAssPath = assPath;
    }

    // 3. ffmpeg encode — yield progress in real time
    const label = noSubtitles ? "without subtitles" : "with subtitles";
    log(`[render] Encoding ${width}×${height} ${label}…`);
    for await (const pct of renderWithProgress(rawPath, effectiveAssPath, outPath, width, height, log)) {
      yield { kind: "progress", percent: pct };
    }

    // 4. Upload
    log(`[render] Uploading rendered clip to ${outputKey}…`);
    const fileSizeBytes = await uploadToMinio(outPath, outputKey);
    const presignedUrl = await buildPresignedUrl(outputKey);
    const processingTimeMs = Date.now() - startedAt;

    // 5. Update DB
    if (cutId) {
      db.update(cuts).set({ renderedStorageKey: outputKey, status: "rendered" }).where(eq(cuts.id, cutId)).run();
    }

    log(`[render] Done in ${(processingTimeMs / 1000).toFixed(1)}s — ${(fileSizeBytes / 1024 / 1024).toFixed(2)} MB`);

    yield {
      kind: "done",
      result: { storageKey: outputKey, presignedUrl, resolution: `${width}x${height}`, durationMs, fileSizeBytes, processingTimeMs },
    };
  } finally {
    for (const p of [rawPath, assPath, outPath]) {
      if (existsSync(p)) { try { unlinkSync(p); } catch { /* ignore */ } }
    }
  }
}
