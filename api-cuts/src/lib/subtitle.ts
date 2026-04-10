/**
 * Generates an ASS subtitle file with a karaoke word-highlight effect.
 *
 * Style: groups of N words shown at once (all-caps, bold, bottom-centered).
 * The current word being spoken is highlighted in yellow; others are white.
 * This matches the popular TikTok/Shorts caption aesthetic.
 *
 * ASS color format: &HAABBGGRR (alpha, blue, green, red — note reversed channel order)
 * Reference: http://moodub.free.fr/video/ass-specs.doc
 */

import type { TranscriptSegment } from "../modules/transcription/transcription.schema.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SubtitleStyle {
  /** Font size in points (default 110) */
  fontSize?: number;
  /** Primary (non-highlighted) text color in &HAABBGGRR ASS format (default white) */
  primaryColor?: string;
  /** Highlighted word color in &HAABBGGRR ASS format (default yellow) */
  highlightColor?: string;
  /** Outline color (default black) */
  outlineColor?: string;
  /** Outline thickness in pixels (default 5) */
  outlineSize?: number;
  /** Vertical position: "top" | "center" | "bottom" (default "bottom") */
  position?: "top" | "center" | "bottom";
  /** Vertical margin from edge in pixels (default 120) */
  marginV?: number;
  /** Words shown per group/line (default 3) */
  wordsPerGroup?: number;
  /** Whether to uppercase the text (default true) */
  uppercase?: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

//   1=bot-left  2=bot-center  3=bot-right
//   4=mid-left  5=mid-center  6=mid-right
//   7=top-left  8=top-center  9=top-right
const ALIGNMENT_MAP: Record<Required<SubtitleStyle>["position"], number> = {
  bottom: 2,
  center: 5,
  top: 8,
};

// Minimum duration per word (ms) — prevents near-invisible flashes
const MIN_WORD_MS = 120;

// ── Time helpers ──────────────────────────────────────────────────────────────

/** ms → ASS timestamp: H:MM:SS.cs */
function msToAss(ms: number): string {
  const totalCs = Math.floor(ms / 10);
  const h = Math.floor(totalCs / 360_000);
  const m = Math.floor((totalCs % 360_000) / 6_000);
  const s = Math.floor((totalCs % 6_000) / 100);
  const cs = totalCs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

// ── Word timing ───────────────────────────────────────────────────────────────

/**
 * Distributes a segment's duration across its words proportionally by
 * character count (longer words get more time). Returns an array of
 * { word, startMs, endMs } relative to the clip start.
 */
function distributeWordTimings(
  words: string[],
  segRelStartMs: number,
  segRelEndMs: number
): Array<{ word: string; startMs: number; endMs: number }> {
  if (words.length === 0) return [];

  const totalDuration = segRelEndMs - segRelStartMs;
  const totalChars = words.reduce((sum, w) => sum + Math.max(w.length, 1), 0);

  const result: Array<{ word: string; startMs: number; endMs: number }> = [];
  let cursor = segRelStartMs;

  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    const charRatio = Math.max(word.length, 1) / totalChars;
    let duration = Math.round(totalDuration * charRatio);
    // Enforce minimum so fast words are still visible
    duration = Math.max(duration, MIN_WORD_MS);
    const start = cursor;
    const end = i === words.length - 1
      ? segRelEndMs                  // last word ends exactly at segment boundary
      : Math.min(cursor + duration, segRelEndMs - MIN_WORD_MS * (words.length - i - 1));
    result.push({ word, startMs: start, endMs: end });
    cursor = end;
  }

  return result;
}

// ── ASS builder ───────────────────────────────────────────────────────────────

/**
 * Generates the full ASS file content with karaoke word-highlight style.
 *
 * @param segments     Transcript segments (absolute ms from video start).
 * @param cutStartMs   Start of the clip in ms — all timestamps are shifted.
 * @param cutEndMs     End of the clip in ms.
 * @param width        Frame width (px).
 * @param height       Frame height (px).
 * @param style        Visual overrides.
 */
export function generateAss(
  segments: TranscriptSegment[],
  cutStartMs: number,
  cutEndMs: number,
  width: number,
  height: number,
  style: SubtitleStyle = {}
): string {
  const {
    fontSize = 110,
    primaryColor = "&H00FFFFFF",   // white
    highlightColor = "&H0000FFFF", // yellow (ASS BGR: B=0, G=255, R=255)
    outlineColor = "&H00000000",   // black
    outlineSize = 5,
    position = "bottom",
    marginV = 120,
    wordsPerGroup = 3,
    uppercase = true,
  } = style;

  const alignment = ALIGNMENT_MAP[position];

  // ── Header ──────────────────────────────────────────────────────────────────
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "Collisions: Normal",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "Timer: 100.0000",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    // Bold=-1, BorderStyle=1 (outline+shadow), Shadow=2
    `Style: Default,Arial,${fontSize},${primaryColor},${highlightColor},${outlineColor},&H00000000,-1,0,0,0,100,100,2,0,1,${outlineSize},2,${alignment},30,30,${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");

  // ── Dialogue lines ─────────────────────────────────────────────────────────
  const dialogueLines: string[] = [];

  for (const seg of segments) {
    const segAbsEnd = seg.offset + seg.duration;

    // Skip segments fully outside the cut window
    if (segAbsEnd <= cutStartMs || seg.offset >= cutEndMs) continue;

    // Clamp to cut boundaries and make relative to clip start
    const relStart = Math.max(seg.offset - cutStartMs, 0);
    const relEnd = Math.min(segAbsEnd - cutStartMs, cutEndMs - cutStartMs);
    if (relEnd <= relStart) continue;

    const rawText = uppercase ? seg.text.trim().toUpperCase() : seg.text.trim();
    const words = rawText.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) continue;

    // Distribute timing across words
    const wordTimings = distributeWordTimings(words, relStart, relEnd);

    // Process words in groups of wordsPerGroup
    for (let g = 0; g < wordTimings.length; g += wordsPerGroup) {
      const group = wordTimings.slice(g, g + wordsPerGroup);
      const groupWords = group.map((wt) => wt.word);

      // For each word in the group, emit a dialogue line where that word
      // is highlighted and the others are in the primary color.
      for (let w = 0; w < group.length; w++) {
        const { startMs, endMs } = group[w]!;

        // Build colored text
        const text = groupWords
          .map((word, idx) => {
            if (idx === w) {
              // Highlighted word: switch to highlight color, then back
              return `{\\c${highlightColor}&}${word}{\\c${primaryColor}&}`;
            }
            return word;
          })
          .join(" ");

        dialogueLines.push(
          `Dialogue: 0,${msToAss(startMs)},${msToAss(endMs)},Default,,0,0,0,,${text}`
        );
      }
    }
  }

  return [header, ...dialogueLines].join("\n");
}
