CREATE TABLE `db_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`host` text NOT NULL,
	`port` integer NOT NULL,
	`database` text NOT NULL,
	`username` text NOT NULL,
	`credential_id` text NOT NULL,
	`tls` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`credential_id`) REFERENCES `credentials`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `db_connections_name_unique` ON `db_connections` (`name`);--> statement-breakpoint
CREATE TABLE `project_db_connections` (
	`project_id` text NOT NULL,
	`db_connection_id` text NOT NULL,
	PRIMARY KEY(`project_id`, `db_connection_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`db_connection_id`) REFERENCES `db_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
