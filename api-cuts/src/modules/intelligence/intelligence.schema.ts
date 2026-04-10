import { z } from "zod";

// ── Request ───────────────────────────────────────────────────────────────────

export const IntelligenceRequestSchema = z.object({
  /** YouTube URL or plain video ID */
  url: z
    .string()
    .url()
    .refine((url) => /youtube\.com|youtu\.be/.test(url), {
      message: "Must be a valid YouTube URL",
    }),
  /** BCP-47 language code for the transcript (default: "en") */
  lang: z.string().length(2).default("en"),
  /** Free-text instruction about what kind of cuts to extract.
   *  Example: "find the funniest moments" or "highlight technical explanations" */
  instructions: z.string().max(1000).optional(),
  /** Maximum number of cuts to return (default: 5) */
  maxCuts: z.coerce.number().int().min(1).max(20).default(5),
  /** Minimum cut duration in milliseconds (default: 15 s) */
  minDurationMs: z.coerce.number().int().min(1000).default(15_000),
  /** Maximum cut duration in milliseconds (default: 60 s) */
  maxDurationMs: z.coerce.number().int().max(300_000).default(60_000),
  /** Override the model for this request (must be a valid OpenRouter slug) */
  model: z.string().optional(),
});

// ── LLM raw output (validated after parsing the AI response) ─────────────────

export const CutSchema = z.object({
  tempo_inicial: z
    .number()
    .int()
    .nonnegative()
    .describe("Start time of the cut in milliseconds"),
  tempo_final: z
    .number()
    .int()
    .positive()
    .describe("End time of the cut in milliseconds"),
  titulo_sugerido: z
    .string()
    .min(1)
    .max(100)
    .describe("Suggested short title for the cut"),
  tags: z
    .array(z.string().min(1).max(30))
    .min(1)
    .max(10)
    .describe("Relevant topic tags (no # prefix)"),
  hashtags: z
    .array(z.string().min(1).max(50))
    .min(3)
    .max(15)
    .describe("Social-media hashtags optimized for reach (no # prefix, mix of broad and niche)"),
  justificativa: z
    .string()
    .max(300)
    .optional()
    .describe("Brief reason why this moment was selected"),
});

export const LlmResponseSchema = z.object({
  cortes: z.array(CutSchema),
});

// ── API response ──────────────────────────────────────────────────────────────

export const IntelligenceResponseSchema = z.object({
  videoId: z.string(),
  model: z.string(),
  cortes: z.array(CutSchema),
  rawCount: z.number().optional(),
  tokensUsed: z.number().optional(),
});

export const ErrorResponseSchema = z.object({
  statusCode: z.number(),
  error: z.string(),
  message: z.string(),
});

export type IntelligenceRequest = z.infer<typeof IntelligenceRequestSchema>;
export type Cut = z.infer<typeof CutSchema>;
export type IntelligenceResponse = z.infer<typeof IntelligenceResponseSchema>;
