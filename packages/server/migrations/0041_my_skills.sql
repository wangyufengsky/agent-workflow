CREATE TABLE `project_skill_bindings` (
	`project_id` text NOT NULL,
	`workflow_key` text NOT NULL,
	`skill_id` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`project_id`, `workflow_key`, `skill_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`skill_id`) REFERENCES `user_skills`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_skills` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`source` text NOT NULL,
	`version` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_skills_name_idx` ON `user_skills` (`name`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `skills` text DEFAULT '[]' NOT NULL;