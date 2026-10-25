CREATE TABLE `credential_vault` (
	`id` integer PRIMARY KEY NOT NULL,
	`salt` blob NOT NULL,
	`scrypt_n` integer NOT NULL,
	`scrypt_r` integer NOT NULL,
	`scrypt_p` integer NOT NULL,
	`wrapped_key` blob NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `credentials` ADD `seal` text DEFAULT 'system' NOT NULL;