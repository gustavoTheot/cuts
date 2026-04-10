import { z } from "zod";

export const TranscriptionRequestSchema = z.object({
  url: z
    .string()
    .url()
    .refine((url) => /youtube\.com|youtu\.be/.test(url), {
      message: "Must be a valid YouTube URL",
    }),
  lang: z.string().length(2).default("en"),
});

export const TranscriptSegmentSchema = z.object({
  text: z.string(),
  offset: z.number(),
  duration: z.number(),
});

export const TranscriptionResponseSchema = z.object({
  videoId: z.string(),
  url: z.string(),
  lang: z.string(),
  fullText: z.string(),
  segments: z.array(TranscriptSegmentSchema),
  totalDuration: z.number(),
  fetchedAt: z.string().datetime(),
  cached: z.boolean(),
});

export const ErrorResponseSchema = z.object({
  statusCode: z.number(),
  error: z.string(),
  message: z.string(),
});

export type TranscriptionRequest = z.infer<typeof TranscriptionRequestSchema>;
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;
export type TranscriptionResponse = z.infer<typeof TranscriptionResponseSchema>;
