// Post-processing utilities for transcript segments.
// Applied regardless of whether segments came from yt-dlp (word-level) or
// youtube-transcript (event-level) to ensure the LLM receives coherent,
// well-bounded sentence chunks with accurate start timestamps.

import type { TranscriptSegment } from "../modules/transcription/transcription.schema.js";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Natural pause between words that signals a sentence boundary (ms) */
const PAUSE_BOUNDARY_MS = 600;
/** Maximum duration to accumulate before forcing a flush (ms) */
const MAX_SENTENCE_MS = 9_000;
/** Minimum accumulated duration before a sentence ending flushes (ms) */
const MIN_SENTENCE_MS = 1_200;
/** Regex matching sentence-ending punctuation */
const SENTENCE_END = /[.!?]\s*$/;

// ── Sentence merger (for word-level input from yt-dlp) ────────────────────────

/**
 * Groups word-level segments into sentence-level segments.
 *
 * Flushes when:
 *   - A natural pause (> PAUSE_BOUNDARY_MS) is detected between words, OR
 *   - Accumulated text ends with sentence-ending punctuation (.!?), OR
 *   - Accumulated duration reaches MAX_SENTENCE_MS
 *
 * Each output segment preserves the precise start offset of its first word.
 */
export function mergeIntoSentences(words: TranscriptSegment[]): TranscriptSegment[] {
  if (words.length === 0) return [];

  const result: TranscriptSegment[] = [];
  let buf: TranscriptSegment[] = [];

  const flush = () => {
    if (buf.length === 0) return;
    const first = buf[0];
    const last = buf[buf.length - 1];
    if (!first || !last) return;
    result.push({
      text: buf.map((w) => w.text).join(" ").replace(/\s{2,}/g, " ").trim(),
      offset: first.offset,
      duration: last.offset + last.duration - first.offset,
    });
    buf = [];
  };

  for (const word of words) {
    const prev = buf[buf.length - 1];

    const firstInBuf = buf[0];
    if (prev && firstInBuf) {
      const gap = word.offset - (prev.offset + prev.duration);
      const accDuration = prev.offset + prev.duration - firstInBuf.offset;

      const hasPause = gap > PAUSE_BOUNDARY_MS;
      const atMaxDuration = accDuration >= MAX_SENTENCE_MS;
      const atSentenceEnd =
        accDuration >= MIN_SENTENCE_MS && SENTENCE_END.test(prev.text);

      if (hasPause || atMaxDuration || atSentenceEnd) {
        flush();
      }
    }

    buf.push(word);
  }

  flush();
  return result;
}

// ── Short-segment merger (for event-level input from youtube-transcript) ──────

/**
 * Merges consecutive segments that are too short to be meaningful on their own.
 * Segments shorter than `minMs` are joined with the following segment so the
 * LLM receives coherent speech chunks rather than isolated 0.5-1s fragments.
 */
export function mergeShortSegments(
  segments: TranscriptSegment[],
  minMs = 1_500
): TranscriptSegment[] {
  if (segments.length === 0) return [];

  const result: TranscriptSegment[] = [];
  let acc: TranscriptSegment | null = null;

  for (const seg of segments) {
    if (!acc) {
      acc = { ...seg };
      continue;
    }

    if (acc.duration < minMs) {
      // Absorb current segment into accumulator
      acc = {
        text: `${acc.text} ${seg.text}`.trim(),
        offset: acc.offset,
        duration: seg.offset + seg.duration - acc.offset,
      };
    } else {
      result.push(acc);
      acc = { ...seg };
    }
  }

  if (acc) result.push(acc);
  return result;
}
