CREATE TABLE `browser_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`revision` integer NOT NULL,
	`definition` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `browser_cases_project_idx` ON `browser_cases` (`project_id`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `browser_case` text;