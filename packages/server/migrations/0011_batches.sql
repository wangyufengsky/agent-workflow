CREATE TABLE `batch_tasks` (
	`batch_id` text NOT NULL,
	`task_id` text NOT NULL,
	`position` integer NOT NULL,
	`target` text NOT NULL,
	PRIMARY KEY(`batch_id`, `position`),
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `batch_tasks_task_id_unique` ON `batch_tasks` (`task_id`);--> statement-breakpoint
CREATE TABLE `batches` (
	`id` text PRIMARY KEY NOT NULL,
	`seq` integer NOT NULL,
	`project_id` text NOT NULL,
	`workflow_id` text NOT NULL,
	`title` text NOT NULL,
	`requirement_template` text NOT NULL,
	`base_branch` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workflow_id`) REFERENCES `workflows`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `batches_seq_unique` ON `batches` (`seq`);