import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  MINIO_ENDPOINT: z.string().min(1),
  MINIO_PORT: z.coerce.number().default(9000),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(1),
  MINIO_BUCKET: z.string().default("cuts"),
  MINIO_USE_SSL: z.string().transform((v) => v === "true" || v === "1").default("false"),
  OPENROUTER_API_KEY: z.string().min(1),
  OPENROUTER_MODEL: z.string().default("google/gemini-2.0-flash-001"),
  // OAuth — optional, only required when using social publishing
  YOUTUBE_CLIENT_ID: z.string().default(""),
  YOUTUBE_CLIENT_SECRET: z.string().default(""),
  TIKTOK_CLIENT_KEY: z.string().default(""),
  TIKTOK_CLIENT_SECRET: z.string().default(""),
  FRONTEND_URL: z.string().default("http://localhost:5173"),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
