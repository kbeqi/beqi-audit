ALTER TABLE `clients` ADD `notify_email` text;--> statement-breakpoint
ALTER TABLE `clients` ADD `notify_reminder` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `clients` ADD `notify_results` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `sites` ADD `reminder_sent_for` text;