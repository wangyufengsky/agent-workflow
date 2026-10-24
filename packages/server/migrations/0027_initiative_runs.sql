CREATE TABLE `initiative_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`initiative_id` text NOT NULL,
	`seq` integer NOT NULL,
	`attempt_id` text NOT NULL,
	`mode` text NOT NULL,
	`instruction` text,
	`open_phase` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`initiative_id`) REFERENCES `initiatives`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `initiative_runs_seq_idx` ON `initiative_runs` (`initiative_id`,`seq`);--> statement-breakpoint
CREATE INDEX `initiative_runs_attempt_idx` ON `initiative_runs` (`attempt_id`);--> statement-breakpoint
ALTER TABLE `initiatives` ADD `allowed_workflows` text;--> statement-breakpoint
ALTER TABLE `initiatives` ADD `summary` text;--> statement-breakpoint
ALTER TABLE `initiatives` ADD `understanding` text;--> statement-breakpoint
ALTER TABLE `initiatives` ADD `coverage` text;