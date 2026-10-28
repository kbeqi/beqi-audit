CREATE TABLE `run_events` (
	`id` text PRIMARY KEY NOT NULL,
	`stream_id` text NOT NULL,
	`seq` integer NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`detail` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `run_events_stream_idx` ON `run_events` (`stream_id`,`seq`);--> statement-breakpoint
ALTER TABLE `fix_proposals` ADD `title` text;--> statement-breakpoint
ALTER TABLE `fix_proposals` ADD `risk` text;--> statement-breakpoint
ALTER TABLE `fix_proposals` ADD `target` text;--> statement-breakpoint
ALTER TABLE `fix_proposals` ADD `applied_by` text;--> statement-breakpoint
ALTER TABLE `fix_proposals` ADD `result` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `model` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `usage` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `agent_summary` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `highlights` text;--> statement-breakpoint
ALTER TABLE `webflow_connections` ADD `label` text;--> statement-breakpoint
ALTER TABLE `webflow_connections` ADD `auth_kind` text DEFAULT 'mcp_oauth' NOT NULL;--> statement-breakpoint
ALTER TABLE `webflow_connections` ADD `refresh_token` text;--> statement-breakpoint
ALTER TABLE `webflow_connections` ADD `expires_at` text;--> statement-breakpoint
ALTER TABLE `webflow_connections` ADD `mcp_server_url` text;--> statement-breakpoint
ALTER TABLE `webflow_connections` ADD `token_endpoint` text;--> statement-breakpoint
ALTER TABLE `webflow_connections` ADD `mcp_client_id` text;--> statement-breakpoint
ALTER TABLE `webflow_connections` ADD `mcp_client_secret` text;