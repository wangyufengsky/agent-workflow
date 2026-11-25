CREATE TABLE `design_diagrams` (
	`id` text PRIMARY KEY NOT NULL,
	`design_id` text NOT NULL,
	`section_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`nodes` text NOT NULL,
	`edges` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`design_id`) REFERENCES `project_designs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`section_id`) REFERENCES `design_sections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `design_diagrams_design_section_idx` ON `design_diagrams` (`design_id`,`section_id`);--> statement-breakpoint
CREATE TABLE `design_files` (
	`id` text PRIMARY KEY NOT NULL,
	`design_id` text NOT NULL,
	`section_id` text,
	`rel_path` text NOT NULL,
	`content_hash` text NOT NULL,
	`responsibility` text,
	`symbols` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`design_id`) REFERENCES `project_designs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`section_id`) REFERENCES `design_sections`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `design_files_design_path_idx` ON `design_files` (`design_id`,`rel_path`);--> statement-breakpoint
CREATE INDEX `design_files_design_section_idx` ON `design_files` (`design_id`,`section_id`);--> statement-breakpoint
CREATE TABLE `design_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`design_id` text NOT NULL,
	`seq` integer NOT NULL,
	`attempt_id` text NOT NULL,
	`target_section_ids` text NOT NULL,
	`done_section_ids` text NOT NULL,
	`instruction` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`design_id`) REFERENCES `project_designs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `design_runs_design_seq_idx` ON `design_runs` (`design_id`,`seq`);--> statement-breakpoint
CREATE INDEX `design_runs_attempt_idx` ON `design_runs` (`attempt_id`);--> statement-breakpoint
CREATE TABLE `design_sections` (
	`id` text PRIMARY KEY NOT NULL,
	`design_id` text NOT NULL,
	`seq` integer NOT NULL,
	`is_selected` integer DEFAULT true NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`scope_paths` text NOT NULL,
	`summary` text NOT NULL,
	`blocks` text,
	`review_state` text NOT NULL,
	`review_notes` text,
	`previous` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`design_id`) REFERENCES `project_designs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `design_sections_design_seq_idx` ON `design_sections` (`design_id`,`seq`);--> statement-breakpoint
CREATE TABLE `design_templates` (
	`key` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`match_hints` text NOT NULL,
	`default_sections` text NOT NULL,
	`focus_prompt` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `project_designs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`title` text NOT NULL,
	`depth` text NOT NULL,
	`template_key` text NOT NULL,
	`template_snapshot` text NOT NULL,
	`layout_style` text NOT NULL,
	`theme` text NOT NULL,
	`exclude_patterns` text NOT NULL,
	`ai_review_enabled` integer NOT NULL,
	`source_snapshot` text NOT NULL,
	`outline_confirmed_at` integer,
	`last_exported_path` text,
	`last_exported_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `project_designs_project_idx` ON `project_designs` (`project_id`,`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `project_designs_updated_idx` ON `project_designs` (`updated_at`,`id`);