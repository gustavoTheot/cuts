import { spawn } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  statSync,
  createReadStream,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { narratedVideos } from "../../db/schema.js";
import { minioClient } from "../../storage/minio.js";
import { env } from "../../config/env.js";
import { AppError } from "../../shared/errors.js";
import { getFfmpegPath } from "../../lib/ffmpegpath.js";
import { generateNarratedScript } from "../../lib/gemini.js";
import { generateAudioAndSubtitles } from "../../lib/edge-tts.js";
import { fetchBrollVideos } from "../../lib/pexels.js";
import type { NarratedRequest, NarratedEvent } from "./narrated.schema.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const PRESIGNED_TTL = 24 * 60 * 60; // 24 h

// ── MinIO helpers ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const minio = minioClient as any;

async function uploadToMinio(filePath: string, storageKey: string): Promise<void> {
  const { size } = statSync(filePath);
  try {
    await minio.putObject(
      env.MINIO_BUCKET,
      storageKey,
      createReadStream(filePath),
      size,
      { "Content-Type": "video/mp4" }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new AppError(502, `Storage upload failed: ${msg}`);
  }
}

async function presignUrl(storageKey: string): Promise<string> {
  return minio.presignedGetObject(env.MINIO_BUCKET, storageKey, PRESIGNED_TTL);
}

// ── FFmpeg helpers ────────────────────────────────────────────────────────────

/**
 * Writes a concat demuxer file that repeats the B-roll clips enough times to
 * safely cover `targetSec` seconds. Excess footage is trimmed at encode time.
 *
 * Assumes each B-roll clip is roughly 15 s on average; repeats the set until
 * the theoretical total exceeds the target with a 2-cycle safety buffer.
 */
function writeConcatList(
  brollPaths: string[],
  targetSec: number,
  concatPath: string
): void {
  const avgClipSec = 15;
  const repetitions = Math.ceil(targetSec / (brollPaths.length * avgClipSec)) + 2;
  const lines = Array.from({ length: repetitions }, () =>
    brollPaths.map((p) => `file '${p.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`)
  ).flat();
  writeFileSync(concatPath, lines.join("\n"));
}

/**
 * Runs the final FFmpeg render:
 *   1. Concat B-roll (looped via concat demuxer)
 *   2. Scale → portrait crop (1080 × 1920) → 30 fps
 *   3. Burn ASS subtitles (center, TikTok-style)
 *   4. Mix TTS audio
 *   5. Encode with Apple VideoToolbox (h264_videotoolbox) at 2 Mbps
 *   6. Trim to exact audio duration
 */
function renderNarratedVideo(
  concatPath: string,
  audioPath: string,
  assPath: string,
  outputPath: string,
  durationSec: number
): Promise<void> {
  const ffmpegPath = getFfmpegPath();

  // ASS filter: FFmpeg on macOS requires backslash-escaped colons in file paths
  const safeAssPath = assPath.replace(/\\/g, "/").replace(/:/g, "\\:");
  const assFilter = `ass='${safeAssPath}'`;

  const args = [
    // ── Inputs ────────────────────────────────────────────────────────────
    "-f", "concat", "-safe", "0",
    "-i", concatPath,    // [0] looped B-roll
    "-i", audioPath,     // [1] TTS audio
    // ── Video processing ──────────────────────────────────────────────────
    "-filter_complex",
    // scale to portrait (expand smaller dimension) → center crop → normalize → subtitles
    `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,` +
    `crop=1080:1920,setsar=1,fps=30[scaled];` +
    `[scaled]${assFilter}[v]`,
    "-map", "[v]",
    "-map", "1:a",
    // ── Encoding ──────────────────────────────────────────────────────────
    "-c:v", "h264_videotoolbox",   // Apple Silicon / macOS hardware encoder
    "-b:v", "2M",
    "-c:a", "aac",
    "-b:a", "128k",
    // ── Output ────────────────────────────────────────────────────────────
    "-t", durationSec.toFixed(3),  // trim to exact audio duration
    "-movflags", "+faststart",      // web-friendly MP4
    "-y",
    outputPath,
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new AppError(500, `FFmpeg exited ${code}: ${stderr.slice(-600)}`));
    });
    proc.on("error", (err) =>
      reject(new AppError(500, `FFmpeg spawn error: ${err.message}`))
    );
  });
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

/**
 * Async generator that orchestrates the full narrated-video pipeline and
 * yields SSE-compatible events at each step:
 *
 *   start → step:script → step:media → step:render → step:upload → done
 *
 * On any failure, yields `{ type: "error" }` and marks the DB record as failed.
 * Temporary files are always cleaned up in the `finally` block.
 */
export async function* runNarratedPipeline(
  request: NarratedRequest
): AsyncGenerator<NarratedEvent> {
  const { tema, voz } = request;
  const id = nanoid();
  const tmpDir = mkdtempSync(join(tmpdir(), `narrated-${id}-`));

  // Persist initial record so the video is trackable immediately
  db.insert(narratedVideos)
    .values({ id, tema, script: "", status: "processing", createdAt: new Date() })
    .run();

  try {
    // ── 1. Script generation (Gemini) ────────────────────────────────────────
    yield { type: "step", step: "script", status: "running", message: "Gerando roteiro com Gemini…" };
    const { script_narracao, termos_busca_pexels } = await generateNarratedScript(tema);
    yield {
      type: "step", step: "script", status: "done",
      message: `Roteiro gerado (${script_narracao.split(/\s+/).length} palavras)`,
    };

    // ── 2. Audio (Edge TTS) + B-roll (Pexels) in parallel ───────────────────
    yield { type: "step", step: "media", status: "running", message: "Gerando áudio e baixando b-roll em paralelo…" };

    const [ttsOutput, brollPaths] = await Promise.all([
      generateAudioAndSubtitles(script_narracao, voz, tmpDir),
      fetchBrollVideos(termos_busca_pexels, tmpDir),
    ]);

    yield {
      type: "step", step: "media", status: "done",
      message: `Áudio gerado (${Math.round(ttsOutput.durationMs / 1000)}s) · ${brollPaths.length} vídeos de fundo`,
    };

    // ── 3. FFmpeg render ─────────────────────────────────────────────────────
    yield { type: "step", step: "render", status: "running", message: "Renderizando vídeo com FFmpeg…" };

    const outputPath = join(tmpDir, "narrated.mp4");
    const concatPath = join(tmpDir, "broll_concat.txt");
    const durationSec = ttsOutput.durationMs / 1000;

    writeConcatList(brollPaths, durationSec, concatPath);
    await renderNarratedVideo(
      concatPath,
      ttsOutput.audioPath,
      ttsOutput.assPath,
      outputPath,
      durationSec
    );

    yield { type: "step", step: "render", status: "done", message: "Vídeo renderizado com sucesso" };

    // ── 4. Upload to MinIO ───────────────────────────────────────────────────
    yield { type: "step", step: "upload", status: "running", message: "Enviando para armazenamento…" };

    const storageKey = `narrated/${id}/output.mp4`;
    await uploadToMinio(outputPath, storageKey);
    const url = await presignUrl(storageKey);

    yield { type: "step", step: "upload", status: "done", message: "Upload concluído" };

    // ── Persist final state ──────────────────────────────────────────────────
    db.update(narratedVideos)
      .set({ script: script_narracao, storageKey, status: "done" })
      .where(eq(narratedVideos.id, id))
      .run();

    yield { type: "done", id, presignedUrl: url, script: script_narracao };

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.update(narratedVideos)
      .set({ status: "failed" })
      .where(eq(narratedVideos.id, id))
      .run();
    yield { type: "error", message };

  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}
