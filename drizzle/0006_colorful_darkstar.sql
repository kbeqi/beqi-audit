CREATE TABLE `ai_answers` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`site_id` text NOT NULL,
	`prompt` text NOT NULL,
	`engine` text NOT NULL,
	`iteration` integer NOT NULL,
	`mentioned` integer DEFAULT false NOT NULL,
	`cited` integer DEFAULT false NOT NULL,
	`recommended` integer DEFAULT false NOT NULL,
	`answer` text NOT NULL,
	`citations` text DEFAULT '[]' NOT NULL,
	`issues` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_answers_run_idx` ON `ai_answers` (`run_id`);--> statement-breakpoint
ALTER TABLE `findings` ADD `confidence` text;--> statement-breakpoint
ALTER TABLE `findings` ADD `effort` text;--> statement-breakpoint
ALTER TABLE `fix_proposals` ADD `effort` text;--> statement-breakpoint
ALTER TABLE `sites` ADD `audit_on_publish` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `sites` ADD `webhook_id` text;--> statement-breakpoint
ALTER TABLE `sites` ADD `webhook_secret` text;--> statement-breakpoint
ALTER TABLE `sites` ADD `ai_prompts` text;