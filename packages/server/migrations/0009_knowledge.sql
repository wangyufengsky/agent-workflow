CREATE TABLE `knowledge_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`sources` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `knowledge_conversations_project_idx` ON `knowledge_conversations` (`project_id`);--> statement-breakpoint
CREATE INDEX `knowledge_conversations_updated_idx` ON `knowledge_conversations` (`updated_at`);--> statement-breakpoint
CREATE TABLE `knowledge_turns` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`seq` integer NOT NULL,
	`question` text NOT NULL,
	`attempt_id` text NOT NULL,
	`answer` text,
	`citations` text,
	`created_at` integer NOT NULL,
	`answered_at` integer,
	FOREIGN KEY (`conversation_id`) REFERENCES `knowledge_conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_turns_conversation_seq_idx` ON `knowledge_turns` (`conversation_id`,`seq`);--> statement-breakpoint
CREATE INDEX `knowledge_turns_attempt_idx` ON `knowledge_turns` (`attempt_id`);