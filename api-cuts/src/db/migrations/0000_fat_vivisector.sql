CREATE TABLE `cuts` (
	`id` text PRIMARY KEY NOT NULL,
	`source_video_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`raw_storage_key` text,
	`rendered_storage_key` text,
	`start_ms` integer NOT NULL,
	`end_ms` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`status` text DEFAULT 'processing' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transcriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`video_id` text NOT NULL,
	`lang` text NOT NULL,
	`full_text` text NOT NULL,
	`segments_json` text NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transcriptions_video_id_unique` ON `transcriptions` (`video_id`);