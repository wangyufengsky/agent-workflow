CREATE TABLE `deck_materials` (
	`id` text PRIMARY KEY NOT NULL,
	`deck_id` text NOT NULL,
	`seq` integer NOT NULL,
	`kind` text NOT NULL,
	`ref_id` text,
	`title` text NOT NULL,
	`content` text NOT NULL,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `deck_materials_deck_idx` ON `deck_materials` (`deck_id`);--> statement-breakpoint
CREATE TABLE `deck_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`deck_id` text NOT NULL,
	`seq` integer NOT NULL,
	`attempt_id` text NOT NULL,
	`targets` text NOT NULL,
	`done` text NOT NULL,
	`instruction` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `deck_runs_deck_idx` ON `deck_runs` (`deck_id`,`seq`);--> statement-breakpoint
CREATE INDEX `deck_runs_attempt_idx` ON `deck_runs` (`attempt_id`);--> statement-breakpoint
CREATE TABLE `deck_slides` (
	`id` text PRIMARY KEY NOT NULL,
	`deck_id` text NOT NULL,
	`seq` integer NOT NULL,
	`layout` text NOT NULL,
	`title` text NOT NULL,
	`points` text NOT NULL,
	`content` text,
	`notes` text NOT NULL,
	`previous` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `deck_slides_deck_seq_idx` ON `deck_slides` (`deck_id`,`seq`);--> statement-breakpoint
CREATE TABLE `decks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`title` text NOT NULL,
	`title_edited` integer NOT NULL,
	`brief` text NOT NULL,
	`slide_count_target` integer,
	`theme` text NOT NULL,
	`understanding` text,
	`outline_confirmed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `decks_project_idx` ON `decks` (`project_id`);--> statement-breakpoint
CREATE INDEX `decks_updated_idx` ON `decks` (`updated_at`);