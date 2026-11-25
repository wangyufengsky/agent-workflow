PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_context_summaries` (
	`session_id` text PRIMARY KEY NOT NULL,
	`task_id` text,
	`attempt_id` text,
	`conversation_id` text,
	`upto_message_id` text NOT NULL,
	`summary_text` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `assistant_conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_context_summaries`("session_id", "task_id", "attempt_id", "conversation_id", "upto_message_id", "summary_text", "updated_at") SELECT "session_id", "task_id", NULL, NULL, "upto_message_id", "summary_text", "updated_at" FROM `context_summaries`;--> statement-breakpoint
DROP TABLE `context_summaries`;--> statement-breakpoint
ALTER TABLE `__new_context_summaries` RENAME TO `context_summaries`;--> statement-breakpoint
PRAGMA foreign_keys=ON;