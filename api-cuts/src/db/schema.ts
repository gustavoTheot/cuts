import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

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
