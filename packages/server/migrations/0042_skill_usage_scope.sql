ALTER TABLE `project_skill_bindings` ADD `role_ids` text;--> statement-breakpoint
ALTER TABLE `user_skills` ADD `assistant_enabled` integer DEFAULT true NOT NULL;