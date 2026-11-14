CREATE TABLE `curve_confirmations` (
	`snapshot_id` text PRIMARY KEY NOT NULL,
	`last_seen_at` text NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `curve_snapshots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `curve_heads` (
	`series` text PRIMARY KEY NOT NULL,
	`generation` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "curve_generation_nonnegative" CHECK("curve_heads"."generation" >= 0)
);
--> statement-breakpoint
CREATE TABLE `curve_points` (
	`snapshot_id` text NOT NULL,
	`date` text NOT NULL,
	`kind` text NOT NULL,
	`grid` text NOT NULL,
	`maturity_months` integer NOT NULL,
	`maturity_years` text NOT NULL,
	`source_value` text NOT NULL,
	`value` text NOT NULL,
	`workbook` text NOT NULL,
	PRIMARY KEY(`snapshot_id`, `date`, `kind`, `grid`, `maturity_months`),
	FOREIGN KEY (`snapshot_id`) REFERENCES `curve_snapshots`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "curve_kind" CHECK("curve_points"."kind" IN ('spot','instantaneous-forward')),
	CONSTRAINT "curve_grid" CHECK("curve_points"."grid" IN ('monthly','semiannual'))
);
--> statement-breakpoint
CREATE INDEX `curve_date` ON `curve_points` (`date`,`snapshot_id`);--> statement-breakpoint
CREATE TABLE `curve_publications` (
	`series` text NOT NULL,
	`generation` integer NOT NULL,
	`snapshot_id` text NOT NULL,
	PRIMARY KEY(`series`, `generation`),
	FOREIGN KEY (`series`) REFERENCES `curve_heads`(`series`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`snapshot_id`) REFERENCES `curve_snapshots`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "curve_generation_positive" CHECK("curve_publications"."generation" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `curve_publications_snapshot_id_unique` ON `curve_publications` (`snapshot_id`);--> statement-breakpoint
CREATE TABLE `curve_runs` (
	`id` text NOT NULL,
	`series` text NOT NULL,
	`checked_at` text NOT NULL,
	`outcome` text NOT NULL,
	`phase` text NOT NULL,
	`snapshot_id` text,
	`latest_date` text,
	`point_count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`id`, `series`),
	CONSTRAINT "curve_run_outcome" CHECK("curve_runs"."outcome" IN ('updated','unchanged','empty','failed')),
	CONSTRAINT "curve_run_phase" CHECK("curve_runs"."phase" IN ('acquire','publish','complete'))
);
--> statement-breakpoint
CREATE TABLE `curve_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`series` text NOT NULL,
	`derivation` text NOT NULL,
	`artifact_key` text NOT NULL,
	`raw_key` text NOT NULL,
	`source_hash` text NOT NULL,
	`captured_at` text NOT NULL,
	`ingested_at` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`point_count` integer NOT NULL,
	`decoder` text NOT NULL,
	`access_scope` text NOT NULL,
	`metadata` text NOT NULL,
	FOREIGN KEY (`series`) REFERENCES `curve_heads`(`series`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "curve_point_bound" CHECK("curve_snapshots"."point_count" BETWEEN 1 AND 100000),
	CONSTRAINT "curve_decoder" CHECK("curve_snapshots"."decoder" = 'boe-ois-xlsx-v1'),
	CONSTRAINT "curve_access" CHECK("curve_snapshots"."access_scope" = 'internal-noncommercial')
);
--> statement-breakpoint
CREATE INDEX `curve_snapshot_series` ON `curve_snapshots` (`series`,`captured_at`);