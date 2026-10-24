CREATE TABLE `initiative_items` (
	`id` text PRIMARY KEY NOT NULL,
	`initiative_id` text NOT NULL,
	`key` text NOT NULL,
	`ordinal` integer NOT NULL,
	`title` text NOT NULL,
	`phase` integer NOT NULL,
	`workflow_key` text NOT NULL,
	`requirement` text NOT NULL,
	`depends_on` text NOT NULL,
	`acceptance` text NOT NULL,
	`task_id` text,
	`start_error` text,
	`merge_confirmed_at` integer,
	`dropped_at` integer,
	`drop_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`initiative_id`) REFERENCES `initiatives`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `initiative_items_key_unique` ON `initiative_items` (`initiative_id`,`key`);--> statement-breakpoint
CREATE INDEX `initiative_items_task_idx` ON `initiative_items` (`task_id`);--> statement-breakpoint
CREATE TABLE `initiative_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`position` integer NOT NULL,
	`phases` text NOT NULL,
	`items` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `initiative_templates_key_unique` ON `initiative_templates` (`key`);--> statement-breakpoint
CREATE TABLE `initiatives` (
	`id` text PRIMARY KEY NOT NULL,
	`seq` integer NOT NULL,
	`project_id` text NOT NULL,
	`template_id` text,
	`base_branch` text NOT NULL,
	`title` text NOT NULL,
	`requirement` text NOT NULL,
	`phases` text NOT NULL,
	`confirm_item_plans` integer NOT NULL,
	`breakdown_rev` integer NOT NULL,
	`confirmed_rev` integer NOT NULL,
	`opened_phase` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`template_id`) REFERENCES `initiative_templates`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `initiatives_seq_unique` ON `initiatives` (`seq`);--> statement-breakpoint
CREATE INDEX `initiatives_project_idx` ON `initiatives` (`project_id`,`seq`);