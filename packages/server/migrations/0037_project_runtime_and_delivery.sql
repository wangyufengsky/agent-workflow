CREATE TABLE `project_runtime_checks` (
	`project_id` text PRIMARY KEY NOT NULL,
	`result` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `deliveries` ADD `remote_status` text;--> statement-breakpoint
ALTER TABLE `deliveries` ADD `remote_error` text;