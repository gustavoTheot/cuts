--> statement-breakpoint
ALTER TABLE `cuts` ADD `hashtags_json` text NOT NULL DEFAULT '[]';
--> statement-breakpoint
CREATE TABLE `social_accounts` (
  `id` text PRIMARY KEY NOT NULL,
  `platform` text NOT NULL,
  `platform_user_id` text NOT NULL,
  `username` text NOT NULL,
  `avatar_url` text,
  `access_token` text NOT NULL,
  `refresh_token` text,
  `token_expires_at` integer,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `social_accounts_platform_unique` ON `social_accounts` (`platform`);
--> statement-breakpoint
CREATE TABLE `social_posts` (
  `id` text PRIMARY KEY NOT NULL,
  `cut_id` text NOT NULL REFERENCES `cuts`(`id`) ON DELETE CASCADE,
  `platform` text NOT NULL,
  `platform_post_id` text,
  `platform_post_url` text,
  `status` text NOT NULL DEFAULT 'pending',
  `error_message` text,
  `created_at` integer NOT NULL
);
