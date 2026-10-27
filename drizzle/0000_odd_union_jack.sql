CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`detail` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_log_site_idx` ON `audit_log` (`site_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `clients` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clients_slug_unique` ON `clients` (`slug`);--> statement-breakpoint
CREATE TABLE `finding_states` (
	`site_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`first_seen_run_id` text NOT NULL,
	`last_seen_run_id` text NOT NULL,
	`resolved_run_id` text,
	`note` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finding_states_pk` ON `finding_states` (`site_id`,`fingerprint`);--> statement-breakpoint
CREATE TABLE `findings` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`site_id` text NOT NULL,
	`category` text NOT NULL,
	`check_id` text NOT NULL,
	`severity` text NOT NULL,
	`title` text NOT NULL,
	`detail` text,
	`page_path` text,
	`webflow_page_id` text,
	`fingerprint` text NOT NULL,
	`data` text,
	`ignored` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `findings_run_idx` ON `findings` (`run_id`);--> statement-breakpoint
CREATE INDEX `findings_site_fingerprint_idx` ON `findings` (`site_id`,`fingerprint`);--> statement-breakpoint
CREATE TABLE `fix_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`finding_id` text,
	`fingerprint` text NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`action` text NOT NULL,
	`proposal` text NOT NULL,
	`previous` text,
	`rationale` text,
	`approved_by` text,
	`applied_at` text,
	`error` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`finding_id`) REFERENCES `findings`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `fix_proposals_site_status_idx` ON `fix_proposals` (`site_id`,`status`);--> statement-breakpoint
CREATE TABLE `ignore_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`check_id` text NOT NULL,
	`page_path` text,
	`reason` text,
	`created_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ignore_rules_site_idx` ON `ignore_rules` (`site_id`);--> statement-breakpoint
CREATE TABLE `page_metrics` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`site_id` text NOT NULL,
	`page_path` text NOT NULL,
	`strategy` text NOT NULL,
	`performance_score` integer,
	`lcp_ms` real,
	`cls` real,
	`inp_ms` real,
	`tbt_ms` real,
	`fcp_ms` real,
	`total_bytes` integer,
	`field_lcp_ms` real,
	`field_cls` real,
	`field_inp_ms` real,
	`raw` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `page_metrics_site_path_idx` ON `page_metrics` (`site_id`,`page_path`,`created_at`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`trigger` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`workflow_instance_id` text,
	`started_at` text,
	`finished_at` text,
	`score_overall` integer,
	`scores` text,
	`summary` text,
	`error` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `runs_site_created_idx` ON `runs` (`site_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `sites` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`connection_id` text,
	`webflow_site_id` text NOT NULL,
	`name` text NOT NULL,
	`short_name` text,
	`base_url` text NOT NULL,
	`preview_url` text,
	`audit_frequency` text DEFAULT 'weekly' NOT NULL,
	`next_run_at` text,
	`last_run_id` text,
	`key_pages` text DEFAULT '["/"]' NOT NULL,
	`max_pages` integer DEFAULT 200 NOT NULL,
	`is_enterprise` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `webflow_connections`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sites_webflow_site_idx` ON `sites` (`webflow_site_id`);--> statement-breakpoint
CREATE INDEX `sites_client_idx` ON `sites` (`client_id`);--> statement-breakpoint
CREATE INDEX `sites_next_run_idx` ON `sites` (`next_run_at`);--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`site_id` text NOT NULL,
	`kind` text NOT NULL,
	`r2_key` text NOT NULL,
	`hash` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `snapshots_site_kind_idx` ON `snapshots` (`site_id`,`kind`,`created_at`);--> statement-breakpoint
CREATE TABLE `webflow_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`workspace_id` text,
	`workspace_name` text,
	`access_token` text NOT NULL,
	`scopes` text NOT NULL,
	`authorized_site_ids` text NOT NULL,
	`authorized_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webflow_connections_client_idx` ON `webflow_connections` (`client_id`);