CREATE TABLE `requirement_results` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`item_id` text NOT NULL,
	`source` text NOT NULL,
	`conclusion` text NOT NULL,
	`note` text NOT NULL,
	`output` text,
	`node_id` text,
	`commit_sha` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`revision_id`) REFERENCES `requirement_revisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `requirement_results_task_idx` ON `requirement_results` (`task_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `requirement_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`seq` integer NOT NULL,
	`items` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `requirement_revisions_task_seq_idx` ON `requirement_revisions` (`task_id`,`seq`);