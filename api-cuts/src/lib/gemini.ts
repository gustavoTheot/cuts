import { z } from "zod";
import { openrouter } from "./openrouter.js";
import { env } from "../config/env.js";
import { AppError } from "../shared/errors.js";

// ── Response schema ───────────────────────────────────────────────────────────

const GeminiScriptSchema = z.object({
  script_narracao: z.string().min(50),
  termos_busca_pexels: z.array(z.string().max(60)).length(3),
});

export type GeminiScript = z.infer<typeof GeminiScriptSchema>;

// ── JSON extractor ────────────────────────────────────────────────────────────

function extractJson(raw: string): unknown {
  try { return JSON.parse(raw.trim()); } catch { /* continue */ }
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  if (fence?.[1]) try { return JSON.parse(fence[1].trim()); } catch { /* continue */ }
  const match = /\{[\s\S]*\}/m.exec(raw);
  if (match) try { return JSON.parse(match[0]); } catch { /* continue */ }
  throw new AppError(502, "Model returned a non-JSON response");
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Calls the configured OpenRouter model to generate a narration script and
 * Pexels search terms for a given topic.
 */
export async function generateNarratedScript(tema: string): Promise<GeminiScript> {
  const prompt = `Você é um roteirista especialista em vídeos virais para TikTok e YouTube Shorts.

Crie um roteiro narrado em português brasileiro sobre o tema: "${tema}"

REGRAS OBRIGATÓRIAS:
- script_narracao: texto de narração com 60–70 segundos de leitura em ritmo natural (≈ 140–160 palavras)
- Comece com um gancho forte nos primeiros 3 segundos — PROIBIDO começar com "olá", "oi", "bem-vindos" ou qualquer saudação
- Linguagem direta, coloquial e envolvente; use dados e números reais quando possível
- Termine com uma conclusão ou call-to-action impactante
- termos_busca_pexels: 3 termos curtos em INGLÊS (1–2 palavras) que representem cenas visuais de fundo adequadas ao tema
  (ex: "city lights", "forest nature", "business meeting")

Retorne SOMENTE o JSON abaixo, sem texto adicional:
{
  "script_narracao": "<roteiro completo de 60-70 segundos>",
  "termos_busca_pexels": ["<termo1>", "<termo2>", "<termo3>"]
}`;

  let rawText: string;
  try {
    const completion = await openrouter.chat.completions.create({
      model: env.OPENROUTER_MODEL,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });
    rawText = completion.choices[0]?.message?.content?.trim() ?? "";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new AppError(502, `OpenRouter API error: ${msg}`);
  }

  if (!rawText) {
    throw new AppError(502, "OpenRouter returned an empty response");
  }

  const parsed = extractJson(rawText);
  const validated = GeminiScriptSchema.safeParse(parsed);

  if (!validated.success) {
    throw new AppError(502, `Model response schema mismatch: ${validated.error.message}`);
  }

  return validated.data;
}
