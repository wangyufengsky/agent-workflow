CREATE TABLE `deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`strategy` text NOT NULL,
	`target_branch` text NOT NULL,
	`status` text NOT NULL,
	`commit_sha` text,
	`pr_url` text,
	`conflict_files` text,
	`error` text,
	`created_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `deliveries_task_idx` ON `deliveries` (`task_id`,`created_at`);