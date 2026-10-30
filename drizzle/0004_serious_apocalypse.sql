ALTER TABLE `runs` ADD `share_token` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `shared_at` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `shared_by` text;--> statement-breakpoint
CREATE UNIQUE INDEX `runs_share_token_unique` ON `runs` (`share_token`);