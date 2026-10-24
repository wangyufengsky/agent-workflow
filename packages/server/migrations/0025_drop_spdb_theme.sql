-- The SPDB theme is removed (D154); it was close to DeepSeek, which takes its place.
UPDATE `settings` SET `value` = '"deepseek"' WHERE `key` = 'ui.theme' AND `value` = '"spdb"';--> statement-breakpoint
UPDATE `decks` SET `theme` = 'deepseek' WHERE `theme` = 'spdb';
