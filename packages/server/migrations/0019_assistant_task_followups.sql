CREATE TABLE `assistant_task_followups` (
	`task_id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`last_event_id` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `assistant_conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assistant_task_followups_conversation_idx` ON `assistant_task_followups` (`conversation_id`);