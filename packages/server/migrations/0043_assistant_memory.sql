CREATE TABLE `assistant_memories` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`content` text NOT NULL,
	`source_conversation_id` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_conversation_id`) REFERENCES `assistant_conversations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `assistant_memories_project_updated_idx` ON `assistant_memories` (`project_id`,`updated_at`);