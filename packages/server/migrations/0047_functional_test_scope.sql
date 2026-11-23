CREATE TABLE `functional_tests` (
	`task_id` text PRIMARY KEY NOT NULL,
	`snapshot` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `test_followups` (
	`task_id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`kind` text NOT NULL,
	`executions` text NOT NULL,
	`request_key` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `test_followups_request_key_unique` ON `test_followups` (`request_key`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `functional_test` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `test_start_commit` text;