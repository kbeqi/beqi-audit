ALTER TABLE `sites` ADD `ai_prompt_candidates` text;--> statement-breakpoint
ALTER TABLE `sites` ADD `ai_sample_every` text DEFAULT 'monthly' NOT NULL;--> statement-breakpoint
ALTER TABLE `sites` ADD `ai_sampled_for` text;