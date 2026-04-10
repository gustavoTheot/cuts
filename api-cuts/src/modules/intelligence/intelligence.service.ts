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

// ── Prompt builder ────────────────────────────────────────────────────────────

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

function buildSystemPrompt(
  maxCuts: number,
  minDurationMs: number,
  maxDurationMs: number,
  instructions?: string
): string {
  const minSec = (minDurationMs / 1000).toFixed(0);
  const maxSec = (maxDurationMs / 1000).toFixed(0);

  return `Você é um especialista em edição de vídeos para redes sociais (YouTube Shorts, TikTok, Reels).

Sua tarefa é analisar a transcrição de um vídeo com marcadores de tempo e identificar os melhores momentos para criar cortes curtos e envolventes.

## Regras obrigatórias
- Retorne EXATAMENTE um objeto JSON válido com a chave "cortes" contendo um array de cortes.
- Selecione no máximo ${maxCuts} cortes.
- Cada corte deve ter duração entre ${minSec}s e ${maxSec}s.
- Os tempos (tempo_inicial, tempo_final) devem ser em milissegundos.
- Os tempos devem corresponder a momentos reais da transcrição — não invente timestamps.
- Cada corte deve ser autocontido (começa e termina em uma ideia completa).
- Não sobreponha cortes.

## Formato JSON obrigatório (não adicione nada fora deste JSON):
{
  "cortes": [
    {
      "tempo_inicial": <número em ms>,
      "tempo_final": <número em ms>,
      "titulo_sugerido": "<título curto e chamativo, máx 100 chars>",
      "tags": ["<tag1>", "<tag2>", "..."],
      "justificativa": "<motivo resumido da escolha>"
    }
  ]
}
${
  instructions
    ? `\n## Instrução específica do usuário\n${instructions}`
    : "\n## Critério padrão\nPriorize momentos de alto impacto: insights valiosos, humor, surpresas, ou explicações didáticas concisas."
}`;
}

function buildUserMessage(formattedTranscript: string): string {
  return `Analise a transcrição abaixo e identifique os melhores momentos para cortes.\n\n## Transcrição\n${formattedTranscript}`;
}

// ── JSON extraction ───────────────────────────────────────────────────────────

function extractJson(raw: string): unknown {
  // Strip markdown code fences if the model wraps the response
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    // Fallback: find the first {...} block in the response
    const match = /\{[\s\S]*\}/.exec(stripped);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        // fall through
      }
    }
    throw new AppError(502, "LLM returned a response that is not valid JSON");
  }
}

// ── Duration filter ───────────────────────────────────────────────────────────

function filterByDuration(
  cuts: Cut[],
  minDurationMs: number,
  maxDurationMs: number
): Cut[] {
  return cuts.filter((c) => {
    const duration = c.tempo_final - c.tempo_inicial;
    return duration >= minDurationMs && duration <= maxDurationMs;
  });
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
  const userMessage = buildUserMessage(formattedTranscript);

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
  const parsed = extractJson(rawContent);
  const validated = LlmResponseSchema.safeParse(parsed);

  if (!validated.success) {
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
