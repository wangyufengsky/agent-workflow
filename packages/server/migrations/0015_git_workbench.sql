CREATE TABLE `git_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`target` text NOT NULL,
	`label` text NOT NULL,
	`from_sha` text NOT NULL,
	`parent` integer,
	`to_sha` text,
	`focus` text,
	`attempt_id` text NOT NULL,
	`files` text NOT NULL,
	`summary` text,
	`findings` text,
	`created_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `git_reviews_project_idx` ON `git_reviews` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `git_reviews_attempt_idx` ON `git_reviews` (`attempt_id`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `merge_source` text;