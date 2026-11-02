ALTER TABLE `clients` ADD `lead_name` text;--> statement-breakpoint
ALTER TABLE `clients` ADD `lead_email` text;--> statement-breakpoint
ALTER TABLE `clients` ADD `slack_webhook_url` text;--> statement-breakpoint
ALTER TABLE `fix_proposals` ADD `client_note` text;--> statement-breakpoint
ALTER TABLE `users` ADD `client_id` text;