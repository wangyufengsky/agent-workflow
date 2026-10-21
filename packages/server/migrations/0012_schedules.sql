CREATE TABLE `schedule_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule_id` text NOT NULL,
	`trigger` text NOT NULL,
	`outcome` text NOT NULL,
	`due_at` integer NOT NULL,
	`missed` integer NOT NULL,
	`task_id` text,
	`error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`schedule_id`) REFERENCES `schedules`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `schedule_runs_schedule_idx` ON `schedule_runs` (`schedule_id`);--> statement-breakpoint
CREATE TABLE `schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`workflow_key` text NOT NULL,
	`title` text NOT NULL,
	`requirement` text NOT NULL,
	`base_branch` text,
	`frequency` text NOT NULL,
	`status` text NOT NULL,
	`next_run_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
