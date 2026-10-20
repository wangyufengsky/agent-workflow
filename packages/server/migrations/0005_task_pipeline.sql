CREATE TABLE `inbox_items` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`task_id` text,
	`node_id` text,
	`attempt_id` text,
	`title` text NOT NULL,
	`payload` text NOT NULL,
	`response` text,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `inbox_status_created_idx` ON `inbox_items` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `inbox_task_idx` ON `inbox_items` (`task_id`);--> statement-breakpoint
CREATE TABLE `nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`key` text NOT NULL,
	`title` text NOT NULL,
	`role_id` text NOT NULL,
	`instructions` text NOT NULL,
	`depends_on` text NOT NULL,
	`acceptance` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`attempt_count` integer NOT NULL,
	`retry_feedback` text,
	`result` text,
	`check_results` text,
	`commit_sha` text,
	`position` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `nodes_task_key_unique` ON `nodes` (`task_id`,`key`);--> statement-breakpoint
CREATE INDEX `nodes_task_status_idx` ON `nodes` (`task_id`,`status`);--> statement-breakpoint
CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`source` text NOT NULL,
	`graph` text NOT NULL,
	`summary` text,
	`assumptions` text NOT NULL,
	`feedback` text,
	`created_by_attempt_id` text,
	`created_at` integer NOT NULL,
	`confirmed_at` integer,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plans_task_version_unique` ON `plans` (`task_id`,`version`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`seq` integer NOT NULL,
	`key` text NOT NULL,
	`project_id` text NOT NULL,
	`workflow_id` text NOT NULL,
	`title` text NOT NULL,
	`requirement` text NOT NULL,
	`status` text NOT NULL,
	`failed_phase` text,
	`failure` text,
	`checkpoints` text NOT NULL,
	`base_branch` text NOT NULL,
	`base_commit` text,
	`branch` text,
	`current_plan_id` text,
	`result` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`workflow_id`) REFERENCES `workflows`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_seq_unique` ON `tasks` (`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_key_unique` ON `tasks` (`key`);--> statement-breakpoint
CREATE INDEX `tasks_project_status_idx` ON `tasks` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `tasks_status_updated_idx` ON `tasks` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `task_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`type` text NOT NULL,
	`from_status` text,
	`to_status` text,
	`payload` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_events_task_idx` ON `task_events` (`task_id`,`id`);--> statement-breakpoint
CREATE TABLE `worktrees` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`task_id` text NOT NULL,
	`path` text NOT NULL,
	`branch` text NOT NULL,
	`base_commit` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`removed_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `worktrees_task_id_unique` ON `worktrees` (`task_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `worktrees_path_unique` ON `worktrees` (`path`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text,
	`node_id` text,
	`kind` text NOT NULL,
	`seq` integer NOT NULL,
	`status` text NOT NULL,
	`role_id` text,
	`model` text,
	`directory` text NOT NULL,
	`opencode_session_id` text,
	`nudges` integer NOT NULL,
	`error` text,
	`tokens_input` integer,
	`tokens_output` integer,
	`cost` real,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_attempts`("id", "task_id", "node_id", "kind", "seq", "status", "role_id", "model", "directory", "opencode_session_id", "nudges", "error", "tokens_input", "tokens_output", "cost", "started_at", "ended_at") SELECT "id", "task_id", "node_id", "kind", "seq", "status", "role_id", "model", "directory", "opencode_session_id", "nudges", "error", "tokens_input", "tokens_output", "cost", "started_at", "ended_at" FROM `attempts`;--> statement-breakpoint
DROP TABLE `attempts`;--> statement-breakpoint
ALTER TABLE `__new_attempts` RENAME TO `attempts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `attempts_node_id_idx` ON `attempts` (`node_id`);--> statement-breakpoint
CREATE INDEX `attempts_task_kind_idx` ON `attempts` (`task_id`,`kind`);--> statement-breakpoint
CREATE INDEX `attempts_status_idx` ON `attempts` (`status`);--> statement-breakpoint
CREATE INDEX `attempts_session_idx` ON `attempts` (`opencode_session_id`);