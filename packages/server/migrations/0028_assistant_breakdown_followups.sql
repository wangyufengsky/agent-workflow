CREATE TABLE `assistant_breakdown_followups` (
	`attempt_id` text PRIMARY KEY NOT NULL,
	`initiative_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`reported` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`initiative_id`) REFERENCES `initiatives`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `assistant_conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assistant_breakdown_followups_initiative_idx` ON `assistant_breakdown_followups` (`initiative_id`);