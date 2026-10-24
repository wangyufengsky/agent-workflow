CREATE TABLE `assistant_analysis_followups` (
	`analysis_id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`reported` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`analysis_id`) REFERENCES `team_analyses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `assistant_conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assistant_analysis_followups_conversation_idx` ON `assistant_analysis_followups` (`conversation_id`);--> statement-breakpoint
CREATE TABLE `team_analyses` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`member_email` text NOT NULL,
	`ref` text NOT NULL,
	`ref_sha` text NOT NULL,
	`period_from` text NOT NULL,
	`period_to` text NOT NULL,
	`status` text NOT NULL,
	`commits` text NOT NULL,
	`sample` text NOT NULL,
	`attempt_id` text,
	`report` text,
	`error` text,
	`created_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `team_analyses_project_idx` ON `team_analyses` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `team_analyses_attempt_idx` ON `team_analyses` (`attempt_id`);--> statement-breakpoint
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
	`files` text NOT NULL,
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
