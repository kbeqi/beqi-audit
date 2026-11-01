ALTER TABLE `clients` ADD `notify_monthly` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `clients` ADD `monthly_report_sent_for` text;