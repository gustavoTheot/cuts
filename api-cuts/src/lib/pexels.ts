/**
 * Pexels video client.
 *
 * Searches for portrait B-roll videos and downloads them to a temp directory.
 * All searches run in parallel (Promise.all), and downloads also run in parallel.
 */

import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { env } from "../config/env.js";
import { AppError } from "../shared/errors.js";

// ── Pexels API types ──────────────────────────────────────────────────────────

interface PexelsVideoFile {
  quality: string;
  file_type: string;
  width: number;
  height: number;
  link: string;
}

interface PexelsVideo {
  id: number;
  width: number;
  height: number;
  duration: number;
  video_files: PexelsVideoFile[];
}

interface PexelsSearchResponse {
  videos: PexelsVideo[];
  total_results: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PEXELS_API = "https://api.pexels.com/videos";
const MAX_DURATION_SEC = 45; // skip very long clips

// ── Helpers ───────────────────────────────────────────────────────────────────

function authHeaders(): Record<string, string> {
  return { Authorization: env.PEXELS_API_KEY };
}

/** Returns true if the video is in portrait orientation */
function isPortrait(v: PexelsVideo): boolean {
  return v.height > v.width;
}

/**
 * Picks the best MP4 file from a video's file list.
 * Prefers HD portrait files; falls back to any portrait MP4.
 */
function pickBestFile(video: PexelsVideo): PexelsVideoFile | null {
  const portrait = video.video_files.filter(
    (f) => f.file_type === "video/mp4" && f.height > f.width
  );
  if (portrait.length === 0) return null;

  // Sort: hd > sd > anything else
  const qualityRank: Record<string, number> = { hd: 2, sd: 1 };
  portrait.sort((a, b) => (qualityRank[b.quality] ?? 0) - (qualityRank[a.quality] ?? 0));
  return portrait.length > 0 ? (portrait[0] as PexelsVideoFile) : null;
}

async function searchPortraitVideos(term: string): Promise<PexelsVideo[]> {
  const params = new URLSearchParams({
    query: term,
    orientation: "portrait",
    per_page: "10",
    size: "medium",
  });

  const res = await fetch(`${PEXELS_API}/search?${params}`, {
    headers: authHeaders(),
  });

  if (!res.ok) {
    throw new AppError(502, `Pexels search failed for "${term}": ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as PexelsSearchResponse;
  return (data.videos ?? []).filter(
    (v) => isPortrait(v) && v.duration <= MAX_DURATION_SEC
  );
}

async function downloadVideo(url: string, destPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new AppError(502, `Pexels download failed: ${res.status} ${res.statusText}`);
  }
  // `res.body` is a Web Streams API ReadableStream; Node's pipeline needs a Node stream
  await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(destPath));
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Fetches and downloads 2–3 portrait B-roll videos from Pexels, one per
 * search term. All searches and downloads run in parallel.
 *
 * Throws if no usable video could be found for any of the given terms.
 */
export async function fetchBrollVideos(
  terms: string[],
  tmpDir: string
): Promise<string[]> {
  // Parallel searches — a failed search for one term is non-fatal
  const searchResults = await Promise.all(
    terms.map((term) =>
      searchPortraitVideos(term).catch((err: Error) => {
        console.warn(`[pexels] search failed for "${term}": ${err.message}`);
        return [] as PexelsVideo[];
      })
    )
  );

  // Pick the best usable video from each term's results
  const selected: Array<{ file: PexelsVideoFile; termIndex: number }> = [];
  for (let i = 0; i < searchResults.length; i++) {
    for (const video of (searchResults[i] ?? [])) {
      const file = pickBestFile(video);
      if (file) {
        selected.push({ file, termIndex: i });
        break; // one video per term
      }
    }
  }

  if (selected.length === 0) {
    throw new AppError(
      422,
      "No portrait B-roll videos found on Pexels for the given search terms"
    );
  }

  // Parallel downloads
  const paths = await Promise.all(
    selected.map(async ({ file, termIndex }) => {
      const dest = join(tmpDir, `broll_${termIndex}.mp4`);
      await downloadVideo(file.link, dest);
      console.info(`[pexels] downloaded broll_${termIndex}.mp4 (${file.quality} ${file.width}×${file.height})`);
      return dest;
    })
  );

  return paths;
}
