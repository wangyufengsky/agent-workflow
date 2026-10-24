CREATE TABLE `team_commit_files` (
	`project_id` text NOT NULL,
	`sha` text NOT NULL,
	`path` text NOT NULL,
	`added` integer,
	`deleted` integer,
	PRIMARY KEY(`project_id`, `sha`, `path`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `team_commits` (
	`project_id` text NOT NULL,
	`sha` text NOT NULL,
	`author_email` text NOT NULL,
	`author_name` text NOT NULL,
	`authored_at` integer NOT NULL,
	`subject` text NOT NULL,
	`ai_task` integer NOT NULL,
	`ai_coauthor` integer NOT NULL,
	`requested_by_email` text,
	`requested_by_name` text,
	`reverts_sha` text,
	PRIMARY KEY(`project_id`, `sha`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `team_commits_authored_idx` ON `team_commits` (`project_id`,`authored_at`);--> statement-breakpoint
CREATE TABLE `team_identities` (
	`project_id` text NOT NULL,
	`email` text NOT NULL,
	`member_email` text,
	`display_name` text,
	`hidden` integer NOT NULL,
	PRIMARY KEY(`project_id`, `email`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `team_settings` (
	`project_id` text PRIMARY KEY NOT NULL,
	`exclude_globs` text,
	`test_globs` text,
	`huge_commit_lines` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
