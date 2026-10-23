CREATE TABLE `assistant_turns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` text NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`end_reason` text,
	`model` text,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`elapsed_ms` integer,
	`tokens_input` integer,
	`tokens_output` integer,
	`timeout_ms` integer NOT NULL,
	`message_ids` text NOT NULL,
	`step_ids` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `assistant_conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assistant_turns_conversation_idx` ON `assistant_turns` (`conversation_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `assistant_turns_status_idx` ON `assistant_turns` (`status`);