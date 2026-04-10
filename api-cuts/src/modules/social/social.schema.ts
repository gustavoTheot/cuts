import { z } from "zod";

export const PlatformSchema = z.enum(["youtube", "tiktok"]);
export type Platform = z.infer<typeof PlatformSchema>;

export const SocialAccountSchema = z.object({
  platform: PlatformSchema,
  platformUserId: z.string(),
  username: z.string(),
  avatarUrl: z.string().nullable(),
  connectedAt: z.string().datetime(),
});

export const ListAccountsResponseSchema = z.object({
  accounts: z.array(SocialAccountSchema),
});

export const PublishBodySchema = z.object({
  cutId: z.string().min(1),
  platform: PlatformSchema,
  /** Override title (defaults to cut title) */
  title: z.string().max(100).optional(),
  /** Override description */
  description: z.string().max(2200).optional(),
});

export const PublishResponseSchema = z.object({
  postId: z.string(),
  postUrl: z.string().nullable(),
  platform: PlatformSchema,
  status: z.string(),
});

export const ErrorResponseSchema = z.object({
  statusCode: z.number(),
  error: z.string(),
  message: z.string(),
});

export type PublishBody = z.infer<typeof PublishBodySchema>;
