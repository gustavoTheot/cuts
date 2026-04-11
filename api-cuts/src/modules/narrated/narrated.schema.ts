import { z } from "zod";

// ── Request ───────────────────────────────────────────────────────────────────

export const NarratedRequestSchema = z.object({
  /** Topic that Gemini will use to generate the narration script */
  tema: z.string().min(3).max(500),
  /** Edge TTS voice (defaults to Antonio — male, natural Brazilian Portuguese) */
  voz: z
    .enum(["pt-BR-AntonioNeural", "pt-BR-FranciscaNeural"])
    .default("pt-BR-AntonioNeural"),
});

// ── SSE event union ───────────────────────────────────────────────────────────

export type NarratedStep = "script" | "media" | "render" | "upload";

export type NarratedEvent =
  | { type: "start"; message: string }
  | { type: "step"; step: NarratedStep; status: "running" | "done"; message: string }
  | { type: "done"; id: string; presignedUrl: string; script: string }
  | { type: "error"; message: string };

// ── Types ─────────────────────────────────────────────────────────────────────

export type NarratedRequest = z.infer<typeof NarratedRequestSchema>;
