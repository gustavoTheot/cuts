import { openrouter } from "../../lib/openrouter.js";
import { env } from "../../config/env.js";
import { AppError } from "../../shared/errors.js";
import { getTranscription } from "../transcription/transcription.service.js";
import {
  LlmResponseSchema,
  type Cut,
  type IntelligenceRequest,
  type IntelligenceResponse,
} from "./intelligence.schema.js";
import type { TranscriptSegment } from "../transcription/transcription.schema.js";
import { buildSystemPrompt, buildUserMessage } from "./intelligence.prompts.js";

// ── Transcript formatter ──────────────────────────────────────────────────────

function formatTranscript(segments: TranscriptSegment[]): string {
  return segments
    .map((s) => {
      const totalSec = Math.floor(s.offset / 1000);
      const min = Math.floor(totalSec / 60)
        .toString()
        .padStart(2, "0");
      const sec = (totalSec % 60).toString().padStart(2, "0");
      const ms = String(s.offset % 1000).padStart(3, "0");
      return `[${min}:${sec}.${ms}] ${s.text.trim()}`;
    })
    .join("\n");
}

// ── JSON extraction ───────────────────────────────────────────────────────────

function extractJson(raw: string): unknown {
  // 1. Try raw as-is
  try { return JSON.parse(raw.trim()); } catch { /* continue */ }

  // 2. Extract content from a markdown code block (anywhere in the response)
  const fenceMatch = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  if (fenceMatch?.[1]) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch { /* continue */ }
  }

  // 3. Find the outermost {...} block (greedy — captures the full object)
  const braceMatch = /\{[\s\S]*\}/m.exec(raw);
  if (braceMatch) {
    try { return JSON.parse(braceMatch[0]); } catch { /* continue */ }
  }

  // 4. Last resort: find innermost valid JSON object (for truncated responses)
  const lastBrace = raw.lastIndexOf("}");
  if (lastBrace !== -1) {
    const firstBrace = raw.indexOf("{");
    if (firstBrace !== -1) {
      try { return JSON.parse(raw.slice(firstBrace, lastBrace + 1)); } catch { /* continue */ }
    }
  }

  throw new AppError(502, "LLM returned a response that is not valid JSON");
}

// ── Duration filter ───────────────────────────────────────────────────────────

function filterByDuration(
  cuts: Cut[],
  minDurationMs: number,
  maxDurationMs: number
): Cut[] {
  // Use the user-requested minimum, floored at 5s as absolute safety net
  const effectiveMin = Math.max(5_000, minDurationMs);
  return cuts
    .map((c) => {
      const duration = c.tempo_final - c.tempo_inicial;
      // Truncate clips that are over the max — never discard them
      if (duration > maxDurationMs) {
        return { ...c, tempo_final: c.tempo_inicial + maxDurationMs };
      }
      return c;
    })
    .filter((c) => c.tempo_final - c.tempo_inicial >= effectiveMin);
}

// ── Main service function ─────────────────────────────────────────────────────

export async function analyzeTranscript(
  request: IntelligenceRequest
): Promise<IntelligenceResponse> {
  const { url, lang, instructions, maxCuts, minDurationMs, maxDurationMs } =
    request;
  const model = request.model ?? env.OPENROUTER_MODEL;

  // 1. Get transcript (from cache or fresh fetch)
  const transcription = await getTranscription(url, lang);

  // 2. Build prompt
  const formattedTranscript = formatTranscript(transcription.segments);
  const systemPrompt = buildSystemPrompt(
    maxCuts,
    minDurationMs,
    maxDurationMs,
    instructions
  );
  const userMessage = buildUserMessage(formattedTranscript, Math.round(maxDurationMs / 1000), instructions);

  // 3. Call LLM via OpenRouter
  let rawContent: string;
  let tokensUsed: number | undefined;

  try {
    const completion = await openrouter.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.3,
    });

    const choice = completion.choices[0];
    if (!choice?.message.content) {
      throw new AppError(502, "LLM returned an empty response");
    }
    rawContent = choice.message.content;
    tokensUsed = completion.usage?.total_tokens;
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new AppError(502, `LLM request failed: ${message}`);
  }

  // 4. Parse and validate response
  let parsed: unknown;
  try {
    parsed = extractJson(rawContent);
  } catch {
    console.error("[intelligence] Raw LLM content (first 1000 chars):", rawContent.slice(0, 1000));
    throw new AppError(502, "LLM returned a response that is not valid JSON");
  }

  const validated = LlmResponseSchema.safeParse(parsed);

  if (!validated.success) {
    console.error("[intelligence] Schema mismatch:", validated.error.message);
    console.error("[intelligence] Parsed object keys:", Object.keys(parsed as object));
    throw new AppError(
      502,
      `LLM response did not match the expected schema: ${validated.error.message}`
    );
  }

  // 5. Post-process: enforce duration constraints and cap to maxCuts
  const rawCortes = validated.data.cortes;
  const filtered = filterByDuration(rawCortes, minDurationMs, maxDurationMs).slice(0, maxCuts);

  return {
    videoId: transcription.videoId,
    model,
    cortes: filtered,
    rawCount: rawCortes.length,
    tokensUsed,
  };
}
