CREATE TABLE `credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`ciphertext` blob NOT NULL,
	`created_at` integer NOT NULL
);
