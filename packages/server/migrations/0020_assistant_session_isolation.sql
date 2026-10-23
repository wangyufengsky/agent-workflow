ALTER TABLE `assistant_conversations` ADD `isolated` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `assistant_conversations` ADD `retired_session_id` text;