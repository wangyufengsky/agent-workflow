CREATE TABLE `assistant_confirmations` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`input` text NOT NULL,
	`status` text NOT NULL,
	`result` text,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`conversation_id`) REFERENCES `assistant_conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assistant_confirmations_conversation_idx` ON `assistant_confirmations` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `assistant_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`opencode_session_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `assistant_conversations_session_idx` ON `assistant_conversations` (`opencode_session_id`);--> statement-breakpoint
CREATE INDEX `assistant_conversations_updated_idx` ON `assistant_conversations` (`updated_at`);