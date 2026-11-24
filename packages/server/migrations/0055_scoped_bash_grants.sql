CREATE TABLE `bash_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text,
	`task_id` text,
	`project_id` text,
	`directory` text NOT NULL,
	`command` text NOT NULL,
	`fingerprint` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `assistant_conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
