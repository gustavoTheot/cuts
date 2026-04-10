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
  const minSec = Math.round(minDurationMs / 1000);
  const maxSec = Math.round(maxDurationMs / 1000);
  const targetSec = maxSec; // user-selected value is the intended duration
  const today = new Date().toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const instructionsBlock = instructions
    ? `## Direcionamento temático do usuário
"${instructions}"

IMPORTANTE: Interprete isso como um TEMA ou INTENÇÃO — não como uma string literal a encontrar no texto.
Selecione momentos que se conectem a essa ideia, mesmo que com vocabulário diferente ou abordagem indireta.
Se um segmento trata do assunto de forma tangencial mas relevante, prefira-o a um que não trate do tema.`
    : `## Critério de seleção padrão
Priorize momentos que combinem: alto impacto emocional (humor, surpresa, revelação, controvérsia construtiva)
+ relevância para o público atual + densidade de informação. Evite momentos introdutórios ou de transição.`;

  return `Você é um editor sênior especializado em cortes virais para YouTube Shorts, TikTok e Instagram Reels.

Hoje é ${today}. Use seu conhecimento sobre eventos recentes, tendências culturais e o que está em alta no debate público para avaliar o potencial de cada momento — escolha os trechos mais relevantes para o mundo agora, não apenas os mais "interessantes" isoladamente.

## Sua missão
Analisar a transcrição e selecionar exatamente até ${maxCuts} momento(s) com maior potencial de engajamento viral.

## O que faz um corte viral
1. **Gancho imediato** — começa com uma afirmação forte, pergunta provocativa ou dado surpreendente
2. **Autonomia** — faz sentido completo sem o contexto do restante do vídeo
3. **Relevância atual** — conecta-se a algo que as pessoas estão discutindo ou experienciando agora
4. **Arco completo** — começa e termina em pontos naturais de fala (nunca no meio de uma frase)
5. **Densidade** — cada segundo carrega informação ou emoção útil, sem rodeios

## Regras de duração — CRÍTICO, não negocie isso
- Duração-alvo de CADA corte: aproximadamente **${targetSec} segundos**
- Duração MÍNIMA absoluta: ${minSec}s — cortes mais curtos serão rejeitados automaticamente
- Duração MÁXIMA absoluta: ${maxSec}s
- Tempos em **milissegundos** (ex.: 1 min 30 s = 90000)
- Use os timestamps da transcrição como âncora. Expanda o trecho para cima/baixo para atingir a duração-alvo, desde que não ultrapasse ${maxSec}s
- NÃO invente timestamps que não existam na transcrição
- NÃO sobreponha cortes entre si

## Formato de saída — retorne APENAS o JSON abaixo, sem texto antes ou depois:
{
  "cortes": [
    {
      "tempo_inicial": <ms>,
      "tempo_final": <ms>,
      "titulo_sugerido": "<título estilo clickbait inteligente, máx 100 chars, em português>",
      "tags": ["<topico1>", "<topico2>", "<topico3>"],
      "hashtags": ["<hashtag1>", "<hashtag2>", "...", "<hashtag10>"],
      "justificativa": "<por que este momento é relevante agora e tem potencial viral>"
    }
  ]
}

## Regras para hashtags
- Entre 5 e 15 hashtags por corte, SEM o símbolo # (será adicionado automaticamente)
- Mix estratégico: 2-3 hashtags amplas com muito volume (ex: viral, shorts, fyp), 4-6 relacionadas ao tema do vídeo, 2-3 nichadas de alta conversão
- Use termos em português E inglês quando fizer sentido para ampliar alcance
- Priorize hashtags que estão em alta no momento atual (${new Date().getFullYear()})

${instructionsBlock}`;
}

function buildUserMessage(formattedTranscript: string, maxSec: number): string {
  return `Analise a transcrição abaixo e selecione os melhores momentos para cortes de aproximadamente ${maxSec}s cada.

Lembre-se: expanda os trechos para atingir a duração-alvo quando necessário — prefira cortes mais completos a cortes curtos demais.

## Transcrição
${formattedTranscript}`;
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
  const userMessage = buildUserMessage(formattedTranscript, Math.round(maxDurationMs / 1000));

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
      temperature: 0.5,
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
