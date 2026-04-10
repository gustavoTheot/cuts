/**
 * Generates an ASS (Advanced SubStation Alpha) subtitle file from transcript
 * segments. ASS gives full control over font, size, position, outline, and
 * timing — essential for the social-media "burned caption" look.
 *
 * Reference: http://moodub.free.fr/video/ass-specs.doc
 */

import type { TranscriptSegment } from "../modules/transcription/transcription.schema.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SubtitleStyle {
  /** Font size in points (default 80 — readable on a mobile screen) */
  fontSize?: number;
  /** Primary text color in &HAABBGGRR ASS hex format (default white) */
  primaryColor?: string;
  /** Outline color (default black) */
  outlineColor?: string;
  /** Outline thickness in pixels (default 4) */
  outlineSize?: number;
  /** Vertical position: "top" | "center" | "bottom" (default "bottom") */
  position?: "top" | "center" | "bottom";
  /** Vertical margin from edge in pixels (default 120) */
  marginV?: number;
  /** Whether to bold the text (default true) */
  bold?: boolean;
  /**
   * Max characters per subtitle line. Longer segments are split at word
   * boundaries to keep text readable on a narrow portrait screen.
   * Default: 40
   */
  maxCharsPerLine?: number;
}

// ── ASS alignment values ──────────────────────────────────────────────────────
//   1=bot-left  2=bot-center  3=bot-right
//   4=mid-left  5=mid-center  6=mid-right
//   7=top-left  8=top-center  9=top-right

const ALIGNMENT_MAP: Record<Required<SubtitleStyle>["position"], number> = {
  bottom: 2,
  center: 5,
  top: 8,
};

// ── Time helpers ──────────────────────────────────────────────────────────────

/**
 * Converts milliseconds to ASS timestamp format: H:MM:SS.cs (centiseconds).
 * e.g. 92_350 ms → "0:01:32.35"
 */
function msToAss(ms: number): string {
  const totalCs = Math.floor(ms / 10);
  const h = Math.floor(totalCs / 360_000);
  const m = Math.floor((totalCs % 360_000) / 6_000);
  const s = Math.floor((totalCs % 6_000) / 100);
  const cs = totalCs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

// ── Text chunking ─────────────────────────────────────────────────────────────

/**
 * Splits a long segment text into lines that fit within `maxChars` by
 * breaking at word boundaries. Each chunk shares the same timing block
 * with the proportional duration.
 */
function chunkText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [text];
}

// ── ASS script builder ────────────────────────────────────────────────────────

/**
 * Generates the full ASS file content.
 *
 * @param segments  Transcript segments (absolute ms offsets from video start).
 * @param cutStartMs  Start of the cut in ms — used to shift all timestamps to
 *                    a 0-based timeline relative to the rendered clip.
 * @param cutEndMs    End of the cut in ms — segments beyond this are discarded.
 * @param width       Video width in pixels (for PlayResX).
 * @param height      Video height in pixels (for PlayResY).
 * @param style       Visual style overrides.
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
    fontSize = 80,
    primaryColor = "&H00FFFFFF",
    outlineColor = "&H00000000",
    outlineSize = 4,
    position = "bottom",
    marginV = 120,
    bold = true,
    maxCharsPerLine = 40,
  } = style;

  const alignment = ALIGNMENT_MAP[position];
  const boldFlag = bold ? -1 : 0;

  // ── Script header ──────────────────────────────────────────────────────────
  const header = `[Script Info]
ScriptType: v4.00+
Collisions: Normal
PlayResX: ${width}
PlayResY: ${height}
Timer: 100.0000

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,${fontSize},${primaryColor},&H000000FF,${outlineColor},&H00000000,${boldFlag},0,0,0,100,100,0,0,1,${outlineSize},0,${alignment},20,20,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  // ── Dialogue lines ─────────────────────────────────────────────────────────
  const lines: string[] = [header];

  for (const seg of segments) {
    const segStart = seg.offset;
    const segEnd = seg.offset + seg.duration;

    // Skip segments fully outside the cut window
    if (segEnd <= cutStartMs || segStart >= cutEndMs) continue;

    // Clamp to cut boundaries and shift to 0-based clip timeline
    const relStart = Math.max(segStart - cutStartMs, 0);
    const relEnd = Math.min(segEnd - cutStartMs, cutEndMs - cutStartMs);
    if (relEnd <= relStart) continue;

    const textChunks = chunkText(seg.text.trim(), maxCharsPerLine);

    // Split the segment's duration proportionally among chunks
    const chunkDurationMs = (relEnd - relStart) / textChunks.length;

    textChunks.forEach((chunk, i) => {
      const chunkStart = relStart + i * chunkDurationMs;
      const chunkEnd = chunkStart + chunkDurationMs;

      // ASS escaping: replace newlines and curly braces with safe equivalents
      const escaped = chunk
        .replace(/\\/g, "\\\\")
        .replace(/\{/g, "\\{")
        .replace(/\}/g, "\\}")
        .replace(/\n/g, "\\N");

      lines.push(
        `Dialogue: 0,${msToAss(chunkStart)},${msToAss(chunkEnd)},Default,,0,0,0,,${escaped}`
      );
    });
  }

  return lines.join("\n");
}
