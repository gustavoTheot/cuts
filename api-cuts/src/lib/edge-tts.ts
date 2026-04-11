/**
 * Edge TTS wrapper.
 *
 * Streams audio from Microsoft Edge TTS with `wordBoundaryEnabled: true` so
 * that the `metadataStream` carries per-word timing (offset + duration in
 * 100-nanosecond ticks). Those timings are used to produce a perfectly-synced
 * ASS subtitle file — no Whisper transcription step needed.
 *
 * Metadata stream format (per chunk):
 *   { Metadata: [{ Type: "WordBoundary", Data: { Offset, Duration,
 *                  text: { Text, Length, BoundaryType } } }] }
 */

import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateAss } from "./subtitle.js";
import { AppError } from "../shared/errors.js";
import type { Readable } from "node:stream";
import type { TranscriptSegment } from "../modules/transcription/transcription.schema.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type NarrationVoice = "pt-BR-AntonioNeural" | "pt-BR-FranciscaNeural";

export interface TtsOutput {
  audioPath: string;
  assPath: string;
  /** Total audio duration in milliseconds */
  durationMs: number;
}

interface MetadataItem {
  Type: string;
  Data: {
    Offset: number;
    Duration: number;
    text: { Text: string; BoundaryType: string };
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Estimates narration duration at ~150 wpm */
function estimateDurationMs(text: string): number {
  return Math.round((text.trim().split(/\s+/).length / 150) * 60_000);
}

/** Even-distribution fallback when no word-boundary events were received */
function buildEvenSegments(text: string, durationMs: number): TranscriptSegment[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const msPerWord = durationMs / words.length;
  return words.map((w, i) => ({
    text: w,
    offset: Math.round(i * msPerWord),
    duration: Math.round(msPerWord),
  }));
}

/** Collects all Buffer chunks from a Readable into a single Buffer */
function collectStream(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Generates an MP3 + ASS subtitle file from `text` using Edge TTS.
 * Word-boundary timing is extracted from the `metadataStream` so subtitle sync
 * is derived directly from the TTS output with no extra transcription step.
 */
export async function generateAudioAndSubtitles(
  text: string,
  voice: NarrationVoice,
  tmpDir: string
): Promise<TtsOutput> {
  const audioPath = join(tmpDir, "narration.mp3");
  const assPath = join(tmpDir, "subtitles.ass");

  const tts = new MsEdgeTTS();

  // wordBoundaryEnabled: true → metadataStream is populated
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
    wordBoundaryEnabled: true,
  } as Parameters<typeof tts.setMetadata>[2]);

  const { audioStream, metadataStream } = tts.toStream(text) as {
    audioStream: Readable;
    metadataStream: Readable | null;
  };

  // Collect audio + metadata concurrently
  const [audioBuffer, metaBuffer] = await Promise.all([
    collectStream(audioStream),
    metadataStream ? collectStream(metadataStream) : Promise.resolve(Buffer.alloc(0)),
  ]);

  if (audioBuffer.length === 0) {
    throw new AppError(502, "Edge TTS produced no audio — check voice name and connectivity");
  }

  writeFileSync(audioPath, audioBuffer);

  // Parse word-boundary events from the metadata buffer
  const wordSegments: TranscriptSegment[] = [];
  if (metaBuffer.length > 0) {
    try {
      const parsed = JSON.parse(metaBuffer.toString()) as { Metadata?: MetadataItem[] };
      for (const item of parsed.Metadata ?? []) {
        if (item.Type === "WordBoundary" && item.Data.text.BoundaryType === "WordBoundary") {
          const wordText = item.Data.text.Text.trim();
          if (wordText) {
            wordSegments.push({
              text: wordText,
              offset: Math.floor(item.Data.Offset / 10_000),    // 100ns ticks → ms
              duration: Math.floor(item.Data.Duration / 10_000),
            });
          }
        }
      }
    } catch { /* malformed metadata — fall back to even distribution */ }
  }

  // Determine duration and segments
  const lastWord = wordSegments.at(-1);
  const durationMs = lastWord
    ? lastWord.offset + lastWord.duration
    : estimateDurationMs(text);

  const segments =
    wordSegments.length > 0 ? wordSegments : buildEvenSegments(text, durationMs);

  // Reuse the project's ASS generator (TikTok-style centered captions)
  const assContent = generateAss(segments, 0, durationMs, 1080, 1920, {
    fontSize: 90,
    position: "center",
    wordsPerGroup: 3,
    uppercase: true,
  });
  writeFileSync(assPath, assContent);

  return { audioPath, assPath, durationMs };
}
