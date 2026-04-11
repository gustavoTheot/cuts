import { YoutubeTranscript } from "../../lib/youtube-transcript.js";
import { eq, and, gt } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../../db/client.js";
import { transcriptions } from "../../db/schema.js";
import { AppError } from "../../shared/errors.js";
import { fetchTranscriptViaYtDlp } from "../../lib/ytdlp-transcript.js";
import { mergeIntoSentences, mergeShortSegments } from "../../lib/transcript-postprocess.js";
import type { TranscriptSegment, TranscriptionResponse } from "./transcription.schema.js";

const YOUTUBE_ID_REGEX = /(?:v=|youtu\.be\/|shorts\/)([A-Za-z0-9_-]{11})/;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function extractVideoId(url: string): string {
  const match = YOUTUBE_ID_REGEX.exec(url);
  const id = match?.[1];
  if (!id) {
    throw new AppError(400, "Cannot extract video ID from URL");
  }
  return id;
}

export async function fetchTranscript(
  videoId: string,
  lang: string
): Promise<TranscriptSegment[]> {
  // ── Strategy 1: yt-dlp json3 ────────────────────────────────────────────────
  // Downloads YouTube's internal subtitle format which includes word-level
  // timestamps (tOffsetMs per word). Produces much more precise cut boundaries
  // than the segment-level offsets from the youtube-transcript library.
  try {
    const words = await fetchTranscriptViaYtDlp(videoId, lang);
    const sentences = mergeIntoSentences(words);
    if (sentences.length > 0) {
      console.info(`[transcription] yt-dlp json3: ${words.length} words → ${sentences.length} sentences`);
      return sentences;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[transcription] yt-dlp json3 failed, falling back to youtube-transcript: ${msg}`);
  }

  // ── Strategy 2: youtube-transcript (fallback) ───────────────────────────────
  // Segment-level offsets only. Post-process to merge very short fragments into
  // coherent chunks so the LLM receives meaningful speech units.
  try {
    const raw = await YoutubeTranscript.fetchTranscript(videoId, { lang });
    const segments = raw.map((item: { text: string; offset: number; duration: number }) => ({
      text: item.text,
      offset: item.offset,
      duration: item.duration,
    }));
    const merged = mergeShortSegments(segments);
    console.info(`[transcription] youtube-transcript fallback: ${segments.length} segments → ${merged.length} after merge`);
    return merged;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new AppError(502, `Transcript unavailable: ${message}`);
  }
}

export function buildTranscriptionResponse(
  videoId: string,
  url: string,
  lang: string,
  segments: TranscriptSegment[],
  cached: boolean
): TranscriptionResponse {
  const fullText = segments.map((s) => s.text).join(" ");
  const last = segments[segments.length - 1];
  const totalDuration = last ? last.offset + last.duration : 0;

  return {
    videoId,
    url,
    lang,
    fullText,
    segments,
    totalDuration,
    fetchedAt: new Date().toISOString(),
    cached,
  };
}

export async function getTranscription(
  url: string,
  lang: string
): Promise<TranscriptionResponse> {
  const videoId = extractVideoId(url);
  const cutoff = new Date(Date.now() - CACHE_TTL_MS);

  // Check cache
  const cached = db
    .select()
    .from(transcriptions)
    .where(
      and(
        eq(transcriptions.videoId, videoId),
        eq(transcriptions.lang, lang),
        gt(transcriptions.fetchedAt, cutoff)
      )
    )
    .get();

  if (cached) {
    const segments = JSON.parse(cached.segmentsJson) as TranscriptSegment[];
    return buildTranscriptionResponse(videoId, url, lang, segments, true);
  }

  // Fetch fresh transcript
  const segments = await fetchTranscript(videoId, lang);

  // Persist to cache (upsert by videoId+lang — replace on conflict)
  db.insert(transcriptions)
    .values({
      id: nanoid(),
      videoId,
      lang,
      fullText: segments.map((s) => s.text).join(" "),
      segmentsJson: JSON.stringify(segments),
      fetchedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: transcriptions.videoId,
      set: {
        lang,
        fullText: segments.map((s) => s.text).join(" "),
        segmentsJson: JSON.stringify(segments),
        fetchedAt: new Date(),
      },
    })
    .run();

  return buildTranscriptionResponse(videoId, url, lang, segments, false);
}
