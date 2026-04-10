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
  const targetSec = maxSec;
  const today = new Date().toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  // Scope block: modifies WHERE to look, never replaces the quality hierarchy
  const scopeBlock = instructions
    ? `## Escopo temático (filtro de busca — definido pelo usuário)
O usuário quer focar em: "${instructions}"

Interprete isso como um TEMA ou INTENÇÃO geral, não como string literal.
Sua tarefa:
1. Varra toda a transcrição e liste mentalmente todos os trechos que se conectam ao tema, mesmo que de forma indireta ou com vocabulário diferente
2. Dentro desses trechos, aplique a Hierarquia de Impacto abaixo para escolher os mais fortes
3. Se o tema coincidir com P1 ou P2 da hierarquia, esses trechos têm prioridade máxima
4. Se o vídeo tiver poucos trechos relevantes ao tema, expanda para conteúdo relacionado antes de retornar menos cortes que o solicitado
5. NUNCA sacrifique a qualidade do corte para forçar o tema — um trecho fraco sobre o tema vale menos que um trecho forte tangencialmente relacionado`
    : `## Escopo temático (modo automático — sem filtro do usuário)
Analise o vídeo inteiro com liberdade total. Aplique diretamente a Hierarquia de Impacto abaixo para encontrar os momentos de maior potencial. Não há tema definido — sua única diretriz é maximizar engajamento e retenção.`;

  return `Você é um editor sênior de vídeos curtos com histórico comprovado de criar cortes virais para YouTube Shorts, TikTok e Instagram Reels. Seu diferencial é extrair o EXATO momento de maior impacto de qualquer vídeo e construir um título que force o clique.

Hoje é ${today}.

## Sua missão
Selecionar até ${maxCuts} momento(s) da transcrição com maior potencial de engajamento viral, aplicando SEMPRE a Hierarquia de Impacto abaixo — independentemente de haver ou não instrução temática do usuário.

${scopeBlock}

## Hierarquia de Impacto — SEMPRE aplique nesta ordem de prioridade
Independente de instrução temática, dentro do conjunto de candidatos elegíveis prefira sempre nesta ordem:

P1 — Dinheiro e finanças (maior taxa de retenção em todos os formatos):
  • Valores reais: salários, faturamento, gastos mensais, lucro, perda, dívida, investimento
  • Revelações de quanto algo custa, quanto alguém ganha/gasta/perde por mês ou ano
  • Como fez dinheiro, perdeu dinheiro ou virou a situação financeira
  • Segredos financeiros, erros caros, atalhos para renda

P2 — Negócios e empreendedorismo com resultado mensurável:
  • Bastidores de como um negócio funciona: margens, modelos de receita, estrutura de custos
  • Decisões corajosas com consequência real (largar emprego, criar empresa, falir, recomeçar)
  • Estratégias que funcionaram ou falharam com números

P3 — Polêmica e opinião forte:
  • Afirmações contrárias ao senso comum com argumentação sólida
  • Críticas a figuras, empresas, produtos ou sistemas conhecidos
  • Revelações que contradizem o que a maioria acredita

P4 — Transformação pessoal com resultado concreto:
  • Antes/depois com números reais (renda, peso, tempo, desempenho)
  • Hábitos ou métodos com efeito comprovado e mensurável

P5 — Humor, surpresa e entretenimento puro:
  • Use apenas quando P1–P4 não estiverem presentes no conjunto elegível

## O que faz um corte funcionar
1. **Gancho imediato** — o primeiro segundo já prende: número real, pergunta provocativa ou revelação inesperada
2. **Autonomia total** — faz sentido completo sem nenhum contexto externo
3. **Arco fechado** — começa e termina em pontos naturais de fala; nunca no meio de uma ideia
4. **Densidade máxima** — cada segundo carrega informação ou emoção; sem introduções nem despedidas
5. **Especificidade** — números reais, nomes, valores e fatos concretos batem generalidades

## Regras de duração — CRÍTICO
- Duração-alvo de CADA corte: aproximadamente **${targetSec} segundos**
- Duração MÍNIMA: ${minSec}s — o sistema rejeita automaticamente cortes menores
- Duração MÁXIMA: ${maxSec}s
- Tempos em **milissegundos** (1 min 30 s = 90000)
- Âncora nos timestamps da transcrição; expanda para cima/baixo para atingir a duração-alvo
- NUNCA invente timestamps; NUNCA sobreponha cortes

## Regras para o título — CRÍTICO
Processo obrigatório:
1. Leia o trecho selecionado e identifique: a afirmação mais forte, o número mais impactante ou a revelação mais surpreendente
2. Use esse elemento como âncora central do título
3. Estrutura por tipo de conteúdo:
   - Financeiro com número: "Gastei R$40k em 30 dias — o que aprendi"
   - Decisão + consequência: "Larguei R$18k/mês para ganhar R$3k — não me arrependo"
   - Pergunta que o espectador já se faz: "Por que quem ganha mais SEMPRE fica sem dinheiro?"
   - Revelação direta: "O que bancos não querem que você saiba sobre juros"
   - Dado + contraste: "Empresa fatura R$500k/mês, dono se paga R$5k"
4. PROIBIDO: "Dicas incríveis", "Você não vai acreditar", "Isso vai te surpreender" sem especificidade concreta
5. O título deve refletir EXATAMENTE o conteúdo do trecho — nunca o tema geral do vídeo
6. Máximo 100 caracteres, em português, caixa mista

## Formato de saída — retorne APENAS o JSON abaixo, sem texto antes ou depois:
{
  "cortes": [
    {
      "tempo_inicial": <ms>,
      "tempo_final": <ms>,
      "titulo_sugerido": "<título ancorado no elemento mais forte do trecho, máx 100 chars>",
      "tags": ["<topico1>", "<topico2>", "<topico3>"],
      "hashtags": ["<hashtag1>", "<hashtag2>", "...", "<hashtag10>"],
      "justificativa": "<cite a frase ou número exato do trecho que ancora a seleção e o título>"
    }
  ]
}

## Regras para hashtags
- Entre 5 e 15 por corte, SEM o símbolo #
- Mix: 2-3 amplas de alto volume (viral, shorts, fyp), 4-6 do tema do trecho, 2-3 nichadas de conversão
- Português e inglês quando fizer sentido`;
}

function buildUserMessage(
  formattedTranscript: string,
  maxSec: number,
  instructions?: string,
): string {
  const modeHint = instructions
    ? `O usuário indicou o tema: "${instructions}". Filtre os candidatos por relevância a esse tema e, dentro deles, aplique a Hierarquia de Impacto para escolher os mais fortes.`
    : `Nenhum tema foi definido pelo usuário. Aplique diretamente a Hierarquia de Impacto em todo o vídeo para encontrar os momentos de maior potencial de engajamento.`;

  return `Selecione os melhores trechos para cortes de aproximadamente ${maxSec}s cada.

${modeHint}

Para cada corte selecionado:
1. Identifique a frase, número ou revelação mais forte dentro do trecho
2. Use esse elemento como âncora do título (não o tema geral do vídeo)
3. Expanda o trecho até atingir a duração-alvo — prefira cortes completos a cortes curtos

## Transcrição
${formattedTranscript}`;
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
