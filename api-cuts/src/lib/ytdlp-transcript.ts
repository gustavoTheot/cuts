// Fetches YouTube subtitles via yt-dlp in json3 format.
// json3 is YouTube's internal subtitle format and includes word-level timestamps
// (tOffsetMs per word) when available — far more precise than the segment-level
// offsets returned by the youtube-transcript library.

import { spawn } from "node:child_process";
import { readFileSync, rmSync, mkdtempSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureYtDlp } from "./ytdlp.js";
import type { TranscriptSegment } from "../modules/transcription/transcription.schema.js";

// ── json3 types ───────────────────────────────────────────────────────────────

interface Json3Seg {
  utf8: string;
  tOffsetMs?: number;
}

interface Json3Event {
  tStartMs: number;
  dDurationMs?: number;
  segs?: Json3Seg[];
  /** 1 = incremental append event (word-by-word reveal) — skip to avoid duplicates */
  aAppend?: number;
}

interface Json3Transcript {
  events: Json3Event[];
}

// ── Parser ────────────────────────────────────────────────────────────────────

export function parseJson3(raw: string): TranscriptSegment[] {
  const data: Json3Transcript = JSON.parse(raw);
  const segments: TranscriptSegment[] = [];

  for (const event of data.events) {
    // Skip incremental append events — they duplicate content for animation
    if (event.aAppend === 1) continue;
    if (!event.segs) continue;

    const baseMs = event.tStartMs;
    const eventDuration = event.dDurationMs ?? 0;

    // Filter segs that are meaningful text (not just newlines / whitespace)
    const textSegs = event.segs.filter((s) => s.utf8.replace(/\n/g, "").trim());

    if (textSegs.length === 0) continue;

    if (textSegs.length === 1 || textSegs.every((s) => s.tOffsetMs == null)) {
      // No word-level timing: treat the whole event as one segment
      const text = textSegs.map((s) => s.utf8.replace(/\n/g, " ")).join("").trim();
      if (text) {
        segments.push({ text, offset: baseMs, duration: eventDuration || 1_000 });
      }
      continue;
    }

    // Word-level timing available: emit one segment per word
    for (let i = 0; i < textSegs.length; i++) {
      const seg = textSegs[i];
      if (!seg) continue;
      const text = seg.utf8.replace(/\n/g, " ").trim();
      if (!text) continue;

      const wordOffset = baseMs + (seg.tOffsetMs ?? 0);
      const nextSeg = textSegs[i + 1];
      const nextOffset = nextSeg
        ? baseMs + (nextSeg.tOffsetMs ?? 0)
        : baseMs + eventDuration;
      const duration = Math.max(80, nextOffset - wordOffset);

      segments.push({ text, offset: wordOffset, duration });
    }
  }

  return segments;
}

// ── yt-dlp runner ─────────────────────────────────────────────────────────────

function runYtDlp(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: "pipe" });
    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error("yt-dlp subtitle fetch timed out"));
    }, 40_000);
    proc.on("error", (err) => { clearTimeout(timeout); reject(err); });
    proc.on("close", (code) => {
      clearTimeout(timeout);
      // yt-dlp exits 1 when no subs found — treat as "no subs available"
      if (code === 0 || code === 1) resolve();
      else reject(new Error(`yt-dlp exited with code ${code}`));
    });
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Downloads subtitles for `videoId` using yt-dlp and returns the parsed
 * segments with the highest timestamp precision available (word-level when
 * YouTube provides it, event-level otherwise).
 *
 * Prefers manually uploaded subtitles over auto-generated ones.
 * Throws if no subtitle file could be produced for the requested language.
 */
export async function fetchTranscriptViaYtDlp(
  videoId: string,
  lang: string
): Promise<TranscriptSegment[]> {
  const ytdlp = await ensureYtDlp();
  const tmpDir = mkdtempSync(join(tmpdir(), "ytdlp-subs-"));

  try {
    const outTemplate = join(tmpDir, "%(id)s");
    const url = `https://www.youtube.com/watch?v=${videoId}`;

    await runYtDlp(ytdlp, [
      "--write-subs",       // manual subs (preferred — higher quality)
      "--write-auto-subs",  // auto-generated fallback
      "--sub-langs", `${lang},${lang}-*`,
      "--sub-format", "json3",
      "--skip-download",
      "--no-playlist",
      "-q",
      "-o", outTemplate,
      url,
    ]);

    const files = readdirSync(tmpDir).filter((f) => f.endsWith(".json3"));
    if (files.length === 0) {
      throw new Error(`No json3 subtitle found for lang=${lang}`);
    }

    // Prefer manual over auto-generated (yt-dlp names auto files *.orig.* or *.auto.*)
    const subFile =
      files.find((f) => !f.includes(".auto.") && !f.includes(".orig.")) ??
      files[0];
    if (!subFile) throw new Error(`No json3 subtitle found for lang=${lang}`);

    const raw = readFileSync(join(tmpDir, subFile), "utf8");
    return parseJson3(raw);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}
