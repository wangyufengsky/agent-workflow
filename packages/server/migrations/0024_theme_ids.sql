-- Theme ids renamed (D152): deepseek → default first, since `deepseek` now names the new blue-and-white theme.
UPDATE `settings` SET `value` = '"default"' WHERE `key` = 'ui.theme' AND `value` = '"deepseek"';--> statement-breakpoint
UPDATE `settings` SET `value` = '"claude_code"' WHERE `key` = 'ui.theme' AND `value` = '"warm"';--> statement-breakpoint
UPDATE `settings` SET `value` = '"codex"' WHERE `key` = 'ui.theme' AND `value` = '"github_white"';--> statement-breakpoint
UPDATE `decks` SET `theme` = 'default' WHERE `theme` = 'deepseek';--> statement-breakpoint
UPDATE `decks` SET `theme` = 'claude_code' WHERE `theme` = 'warm';--> statement-breakpoint
UPDATE `decks` SET `theme` = 'codex' WHERE `theme` = 'github_white';
