CREATE TABLE `context_summaries` (
	`session_id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`upto_message_id` text NOT NULL,
	`summary_text` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
