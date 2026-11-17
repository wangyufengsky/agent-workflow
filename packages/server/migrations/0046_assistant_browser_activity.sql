CREATE TABLE `assistant_browser_activity` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` text NOT NULL,
	`record` text NOT NULL,
	`at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `assistant_conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assistant_browser_activity_conversation_idx` ON `assistant_browser_activity` (`conversation_id`,`id`);