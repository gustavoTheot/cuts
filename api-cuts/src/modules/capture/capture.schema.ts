import { z } from "zod";

// ── Request ───────────────────────────────────────────────────────────────────

export const CaptureRequestSchema = z.object({
  /** YouTube URL to download from */
  url: z
    .string()
    .url()
    .refine((u) => /youtube\.com|youtu\.be/.test(u), {
      message: "Must be a valid YouTube URL",
    }),
  /** Start time in milliseconds (from intelligence module output) */
  tempo_inicial: z.number().int().nonnegative(),
  /** End time in milliseconds */
  tempo_final: z.number().int().positive(),
  /** Human-readable title for the cut */
  titulo_sugerido: z.string().min(1).max(100),
  /** Tags for the cut */
  tags: z.array(z.string().min(1).max(30)).max(10).default([]),
  /** Social-media hashtags (no # prefix) */
  hashtags: z.array(z.string().min(1).max(50)).max(15).default([]),
  /** Max video resolution (default: 720) */
  maxHeight: z.coerce.number().int().default(720),
}).refine((d) => d.tempo_final > d.tempo_inicial, {
  message: "tempo_final must be greater than tempo_inicial",
  path: ["tempo_final"],
});

// ── Response ──────────────────────────────────────────────────────────────────

export const CaptureResponseSchema = z.object({
  id: z.string(),
  videoId: z.string(),
  storageKey: z.string(),
  presignedUrl: z.string().url(),
  titulo_sugerido: z.string(),
  tags: z.array(z.string()),
  tempo_inicial: z.number(),
  tempo_final: z.number(),
  durationMs: z.number(),
  fileSizeBytes: z.number(),
  createdAt: z.string().datetime(),
});

export const ErrorResponseSchema = z.object({
  statusCode: z.number(),
  error: z.string(),
  message: z.string(),
});

export type CaptureRequest = z.infer<typeof CaptureRequestSchema>;
export type CaptureResponse = z.infer<typeof CaptureResponseSchema>;
