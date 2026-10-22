CREATE TABLE `project_bash_rules` (
	`project_id` text NOT NULL,
	`pattern` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `pattern`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `attempts` ADD `project_id` text REFERENCES projects(id) ON DELETE set null;--> statement-breakpoint
UPDATE `attempts` SET `project_id` = (SELECT `project_id` FROM `tasks` WHERE `tasks`.`id` = `attempts`.`task_id`) WHERE `task_id` IS NOT NULL;--> statement-breakpoint
UPDATE `attempts` SET `project_id` = (SELECT `c`.`project_id` FROM `knowledge_turns` `t` JOIN `knowledge_conversations` `c` ON `c`.`id` = `t`.`conversation_id` WHERE `t`.`attempt_id` = `attempts`.`id`) WHERE `id` IN (SELECT `attempt_id` FROM `knowledge_turns`);--> statement-breakpoint
UPDATE `attempts` SET `project_id` = (SELECT `d`.`project_id` FROM `deck_runs` `r` JOIN `decks` `d` ON `d`.`id` = `r`.`deck_id` WHERE `r`.`attempt_id` = `attempts`.`id`) WHERE `id` IN (SELECT `attempt_id` FROM `deck_runs`);
