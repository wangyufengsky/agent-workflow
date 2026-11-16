CREATE TABLE `initiative_coverage_versions` (
	`initiative_id` text NOT NULL,
	`revision` integer NOT NULL,
	`coverage` text NOT NULL,
	`items` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`initiative_id`) REFERENCES `initiatives`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `initiative_coverage_versions_idx` ON `initiative_coverage_versions` (`initiative_id`,`revision`);--> statement-breakpoint
CREATE TABLE `initiative_item_tasks` (
	`item_id` text NOT NULL,
	`task_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `initiative_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `initiative_item_tasks_task_idx` ON `initiative_item_tasks` (`task_id`);--> statement-breakpoint
CREATE INDEX `initiative_item_tasks_item_idx` ON `initiative_item_tasks` (`item_id`);--> statement-breakpoint
INSERT INTO `initiative_item_tasks` (`item_id`, `task_id`, `created_at`) SELECT `id`, `task_id`, `updated_at` FROM `initiative_items` WHERE `task_id` IS NOT NULL;
--> statement-breakpoint
INSERT INTO `initiative_coverage_versions` (`initiative_id`, `revision`, `coverage`, `items`, `created_at`)
SELECT i.`id`, i.`breakdown_rev`, i.`coverage`,
  (SELECT json_group_array(json_object('id', it.`id`, 'key', it.`key`, 'title', it.`title`)) FROM `initiative_items` it WHERE it.`initiative_id` = i.`id`), i.`updated_at`
FROM `initiatives` i WHERE i.`coverage` IS NOT NULL;
