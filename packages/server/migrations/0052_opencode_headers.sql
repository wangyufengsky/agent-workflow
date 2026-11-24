CREATE TABLE `opencode_headers` (
	`key` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`value` text,
	`credential_id` text,
	`position` integer NOT NULL,
	FOREIGN KEY (`credential_id`) REFERENCES `credentials`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "opencode_headers_single_value" CHECK(("opencode_headers"."value" IS NULL) != ("opencode_headers"."credential_id" IS NULL))
);
