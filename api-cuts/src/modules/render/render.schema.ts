import { z } from "zod";
import { TranscriptSegmentSchema } from "../transcription/transcription.schema.js";

// ── Subtitle style ────────────────────────────────────────────────────────────

export const SubtitleStyleSchema = z.object({
  fontSize: z.number().int().min(20).max(200).default(80),
  primaryColor: z.string().regex(/^&H[0-9A-Fa-f]{8}$/).default("&H00FFFFFF"),
  outlineColor: z.string().regex(/^&H[0-9A-Fa-f]{8}$/).default("&H00000000"),
  outlineSize: z.number().int().min(0).max(20).default(4),
  position: z.enum(["top", "center", "bottom"]).default("bottom"),
  marginV: z.number().int().min(0).max(500).default(120),
  bold: z.boolean().default(true),
  maxCharsPerLine: z.number().int().min(10).max(80).default(40),
});

// ── Output resolution ─────────────────────────────────────────────────────────

export const ResolutionSchema = z.object({
  width: z.number().int().default(1080),
  height: z.number().int().default(1920),
});

// ── Request ───────────────────────────────────────────────────────────────────

export const RenderRequestSchema = z.object({
  /** DB cut id — when provided, the rendered key is persisted back to the record */
  cutId: z.string().optional(),
  /** MinIO storage key for the raw clip (from capture module) */
  storageKey: z.string().min(1),
  /** Start of the clip in ms — used to align subtitle timestamps */
  tempo_inicial: z.number().int().nonnegative(),
  /** End of the clip in ms */
  tempo_final: z.number().int().positive(),
  /** Transcript segments for the video (from transcription module) */
  segments: z.array(TranscriptSegmentSchema).min(1),
  /** Subtitle visual style */
  subtitleStyle: SubtitleStyleSchema.default({}),
  /** When true, subtitles are not burned into the video */
  noSubtitles: z.boolean().default(false),
  /** Output resolution (default: 1080×1920 — standard portrait) */
  resolution: ResolutionSchema.default({}),
}).refine((d) => d.tempo_final > d.tempo_inicial, {
  message: "tempo_final must be greater than tempo_inicial",
  path: ["tempo_final"],
});

// ── Response ──────────────────────────────────────────────────────────────────

export const RenderResponseSchema = z.object({
  storageKey: z.string(),
  presignedUrl: z.string().url(),
  resolution: z.string(),
  durationMs: z.number(),
  fileSizeBytes: z.number(),
  processingTimeMs: z.number(),
});

export const ErrorResponseSchema = z.object({
  statusCode: z.number(),
  error: z.string(),
  message: z.string(),
});

export type RenderRequest = z.infer<typeof RenderRequestSchema>;
export type RenderResponse = z.infer<typeof RenderResponseSchema>;
