CREATE TABLE `attempts` (
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
	`ended_at` integer
);
--> statement-breakpoint
CREATE INDEX `attempts_node_id_idx` ON `attempts` (`node_id`);--> statement-breakpoint
CREATE INDEX `attempts_task_kind_idx` ON `attempts` (`task_id`,`kind`);--> statement-breakpoint
CREATE INDEX `attempts_status_idx` ON `attempts` (`status`);--> statement-breakpoint
CREATE INDEX `attempts_session_idx` ON `attempts` (`opencode_session_id`);