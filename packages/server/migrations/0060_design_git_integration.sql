ALTER TABLE `git_reviews` ADD `design_id` text REFERENCES project_designs(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `git_reviews` ADD `design_snapshot_sha` text;--> statement-breakpoint
ALTER TABLE `git_reviews` ADD `design_match` text;--> statement-breakpoint
ALTER TABLE `git_reviews` ADD `impacts` text;--> statement-breakpoint
ALTER TABLE `git_reviews` ADD `impact_truncated` integer;--> statement-breakpoint
ALTER TABLE `git_reviews` ADD `regression_checks` text;
