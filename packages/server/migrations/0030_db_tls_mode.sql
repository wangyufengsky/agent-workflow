ALTER TABLE `db_connections` ADD `tls_mode` text NOT NULL DEFAULT 'off';--> statement-breakpoint
UPDATE `db_connections` SET `tls_mode` = 'verify' WHERE `tls` = 1;--> statement-breakpoint
ALTER TABLE `db_connections` DROP COLUMN `tls`;
