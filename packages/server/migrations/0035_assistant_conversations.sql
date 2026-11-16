CREATE TABLE `assistant_continuations` (
	`conversation_id` text PRIMARY KEY NOT NULL,
	`source_conversation_id` text NOT NULL,
	`request_id` text NOT NULL,
	`cutoff_seq` integer NOT NULL,
	`handoff_text` text NOT NULL,
	`handoff_kind` text NOT NULL,
	`draft_text` text,
	`created_at` integer NOT NULL,
	`consumed_at` integer,
	FOREIGN KEY (`conversation_id`) REFERENCES `assistant_conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_continuations_request_idx` ON `assistant_continuations` (`request_id`);--> statement-breakpoint
ALTER TABLE `assistant_conversations` ADD `project_id` text;