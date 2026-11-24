CREATE TABLE `database_investigation_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `database_investigations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`task_id` text,
	`conversation_id` text,
	`grant_fingerprint` text NOT NULL,
	`result` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `db_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `assistant_conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "database_investigation_owner" CHECK(("database_investigations"."task_id" IS NULL) != ("database_investigations"."conversation_id" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `database_investigations_task_idx` ON `database_investigations` (`task_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `database_investigations_conversation_idx` ON `database_investigations` (`conversation_id`,`updated_at`);--> statement-breakpoint
ALTER TABLE `project_db_connections` ADD `grant_id` text DEFAULT '' NOT NULL;