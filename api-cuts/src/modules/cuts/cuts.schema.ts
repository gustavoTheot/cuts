import { z } from "zod";

// ── List ──────────────────────────────────────────────────────────────────────

export const ListCutsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const CutItemSchema = z.object({
  id: z.string(),
  sourceVideoId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  tags: z.array(z.string()),
  startMs: z.number(),
  endMs: z.number(),
  durationMs: z.number(),
  status: z.string(),
  presignedUrl: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export const ListCutsResponseSchema = z.object({
  items: z.array(CutItemSchema),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
  totalPages: z.number(),
});

// ── Delete ────────────────────────────────────────────────────────────────────

export const DeleteCutParamsSchema = z.object({
  id: z.string().min(1),
});

export const DeleteCutResponseSchema = z.object({
  success: z.boolean(),
});

// ── Get by ID ─────────────────────────────────────────────────────────────────

export const GetCutParamsSchema = z.object({
  id: z.string().min(1),
});

// ── Update ────────────────────────────────────────────────────────────────────

export const UpdateCutParamsSchema = z.object({
  id: z.string().min(1),
});

export const UpdateCutBodySchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(2000).nullable().optional(),
});

export const ErrorResponseSchema = z.object({
  statusCode: z.number(),
  error: z.string(),
  message: z.string(),
});

export type ListCutsQuery = z.infer<typeof ListCutsQuerySchema>;
export type CutItem = z.infer<typeof CutItemSchema>;
export type UpdateCutBody = z.infer<typeof UpdateCutBodySchema>;
