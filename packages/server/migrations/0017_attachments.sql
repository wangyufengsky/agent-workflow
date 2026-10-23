CREATE TABLE `attachment_refs` (
	`owner_kind` text NOT NULL,
	`owner_id` text NOT NULL,
	`attachment_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_kind`, `owner_id`, `attachment_id`),
	FOREIGN KEY (`attachment_id`) REFERENCES `attachments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `attachment_refs_attachment_idx` ON `attachment_refs` (`attachment_id`);--> statement-breakpoint
CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`name` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`origin` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `attachments_created_idx` ON `attachments` (`created_at`);