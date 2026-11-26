ALTER TABLE `design_runs` ADD `is_incremental` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `design_sections` ADD `source_hashes` text;