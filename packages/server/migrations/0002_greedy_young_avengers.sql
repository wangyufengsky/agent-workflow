CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`repo_path` text NOT NULL,
	`default_branch` text NOT NULL,
	`check_command` text,
	`hosting_provider` text,
	`hosting_base_url` text,
	`hosting_repo` text,
	`hosting_credential_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`hosting_credential_id`) REFERENCES `credentials`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_slug_unique` ON `projects` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `projects_repo_path_unique` ON `projects` (`repo_path`);