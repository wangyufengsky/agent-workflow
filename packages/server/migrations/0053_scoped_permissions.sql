ALTER TABLE `assistant_conversations` ADD `permission_mode` text DEFAULT 'ask' NOT NULL;--> statement-breakpoint
ALTER TABLE `attempts` ADD `permission_baseline` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `permission_mode` text DEFAULT 'ask' NOT NULL;
--> statement-breakpoint
UPDATE roles SET model = (SELECT json_extract(value, '$') FROM settings WHERE key='ai.imageModel')
WHERE key='image_processor' AND model IS NULL AND EXISTS (SELECT 1 FROM settings WHERE key='ai.imageModel' AND json_type(value)='text');
--> statement-breakpoint
DELETE FROM settings WHERE key='ai.imageModel';
