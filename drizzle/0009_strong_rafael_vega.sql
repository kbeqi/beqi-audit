CREATE TABLE `google_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`google_email` text,
	`access_token` text NOT NULL,
	`refresh_token` text,
	`expires_at` text NOT NULL,
	`scopes` text NOT NULL,
	`authorized_by` text,
	`revoked_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `google_connections_client_idx` ON `google_connections` (`client_id`);--> statement-breakpoint
CREATE TABLE `page_stats` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`source` text NOT NULL,
	`date` text NOT NULL,
	`page` text NOT NULL,
	`clicks` integer DEFAULT 0 NOT NULL,
	`impressions` integer DEFAULT 0 NOT NULL,
	`position` real,
	`sessions` integer DEFAULT 0 NOT NULL,
	`key_events` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `page_stats_key` ON `page_stats` (`site_id`,`source`,`date`,`page`);--> statement-breakpoint
CREATE INDEX `page_stats_site_date_idx` ON `page_stats` (`site_id`,`date`);--> statement-breakpoint
ALTER TABLE `sites` ADD `gsc_property` text;--> statement-breakpoint
ALTER TABLE `sites` ADD `ga4_property` text;--> statement-breakpoint
ALTER TABLE `sites` ADD `stats_synced_for` text;