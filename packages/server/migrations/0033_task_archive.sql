CREATE TABLE `app_counters` (
	`name` text PRIMARY KEY NOT NULL,
	`value` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `tasks` ADD `archived_at` integer;--> statement-breakpoint
CREATE INDEX `tasks_archived_idx` ON `tasks` (`archived_at`);--> statement-breakpoint
INSERT INTO `app_counters` (`name`, `value`) SELECT 'task_seq', coalesce(max(`seq`), 0) FROM `tasks`;