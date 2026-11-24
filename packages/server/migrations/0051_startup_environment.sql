CREATE TABLE `startup_environment` (
	`key` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`value` text,
	`credential_id` text,
	`position` integer NOT NULL,
	FOREIGN KEY (`credential_id`) REFERENCES `credentials`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "startup_environment_single_value" CHECK(("startup_environment"."value" IS NULL) != ("startup_environment"."credential_id" IS NULL))
);
