import { z } from "zod";
import { SubtitleStyleSchema } from "../render/render.schema.js";

export const ManualCutSchema = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  title: z.string().min(1).max(300).optional(),
}).refine((d) => d.endMs > d.startMs, {
  message: "endMs must be greater than startMs",
  path: ["endMs"],
});

export const PipelineRequestSchema = z.object({
  url: z
    .string()
    .url()
    .refine((u) => /youtube\.com|youtu\.be/.test(u), {
      message: "Must be a valid YouTube URL",
    }),
  lang: z.string().length(2).default("pt"),
  /** Free-text instructions for the AI (optional) */
  instructions: z.string().max(1000).optional(),
  /** Max number of cuts to generate (1–5) */
  maxCuts: z.coerce.number().int().min(1).max(5).default(3),
  /** Maximum duration of each cut in ms (maps to the duration slider) */
  maxDurationMs: z.coerce.number().int().min(15_000).max(90_000).default(60_000),
  /** Subtitle visual style overrides */
  subtitleStyle: SubtitleStyleSchema.optional(),
  /** When true, subtitles are burned into the video */
  subtitles: z.boolean().default(false),
  /** Manual cut — when provided, skips AI and captures exactly this segment */
  manualCut: ManualCutSchema.optional(),
  /** Override LLM model */
  model: z.string().optional(),
});

// ── SSE event shapes (sent as data: JSON\n\n) ─────────────────────────────────

export type PipelineEvent =
  | { type: "start"; message: string }
  | { type: "step"; step: "transcription" | "intelligence"; status: "running" | "done"; message: string }
  | { type: "cut_progress"; index: number; total: number; phase: "capturing" | "rendering"; titulo: string }
  | { type: "cut_phase_progress"; index: number; phase: "capturing" | "rendering"; percent: number }
  | { type: "cut_ready"; index: number; cut: ReadyCut }
  | { type: "cut_error"; index: number; titulo: string; message: string }
  | { type: "done"; successCount: number; failCount: number }
  | { type: "error"; message: string };

export interface ReadyCut {
  id: string;
  titulo: string;
  tags: string[];
  durationMs: number;
  startMs: number;
  endMs: number;
  presignedUrl: string;
}

export type PipelineRequest = z.infer<typeof PipelineRequestSchema>;
export type ManualCut = z.infer<typeof ManualCutSchema>;
