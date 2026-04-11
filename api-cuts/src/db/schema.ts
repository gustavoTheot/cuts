import { sqliteTable, text, integer, unique } from "drizzle-orm/sqlite-core";

export const transcriptions = sqliteTable("transcriptions", {
  id: text("id").primaryKey(),
  videoId: text("video_id").notNull().unique(),
  lang: text("lang").notNull(),
  fullText: text("full_text").notNull(),
  segmentsJson: text("segments_json").notNull(),
  fetchedAt: integer("fetched_at", { mode: "timestamp" }).notNull(),
});

export const cuts = sqliteTable("cuts", {
  id: text("id").primaryKey(),
  sourceVideoId: text("source_video_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  tagsJson: text("tags_json").notNull().default("[]"),
  hashtagsJson: text("hashtags_json").notNull().default("[]"),
  /** Raw yt-dlp download stored in MinIO (intermediate file) */
  rawStorageKey: text("raw_storage_key"),
  /** Rendered 9:16 clip with burned subtitles stored in MinIO */
  renderedStorageKey: text("rendered_storage_key"),
  startMs: integer("start_ms").notNull(),
  endMs: integer("end_ms").notNull(),
  durationMs: integer("duration_ms").notNull(),
  /** processing → captured → rendered | failed */
  status: text("status").notNull().default("processing"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const socialAccounts = sqliteTable("social_accounts", {
  id: text("id").primaryKey(),
  /** youtube | tiktok */
  platform: text("platform").notNull(),
  platformUserId: text("platform_user_id").notNull(),
  username: text("username").notNull(),
  avatarUrl: text("avatar_url"),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  tokenExpiresAt: integer("token_expires_at"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (t) => ({ uniqPlatform: unique().on(t.platform) }));

export const narratedVideos = sqliteTable("narrated_videos", {
  id: text("id").primaryKey(),
  tema: text("tema").notNull(),
  script: text("script").notNull().default(""),
  storageKey: text("storage_key"),
  /** processing | done | failed */
  status: text("status").notNull().default("processing"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const socialPosts = sqliteTable("social_posts", {
  id: text("id").primaryKey(),
  cutId: text("cut_id").notNull().references(() => cuts.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  platformPostId: text("platform_post_id"),
  platformPostUrl: text("platform_post_url"),
  /** pending | published | failed */
  status: text("status").notNull().default("pending"),
  errorMessage: text("error_message"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
