CREATE TABLE `benchmark_heads` (
	`series` text PRIMARY KEY NOT NULL,
	`generation` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "generation_nonnegative" CHECK("benchmark_heads"."generation" >= 0)
);
--> statement-breakpoint
CREATE TABLE `benchmark_observations` (
	`snapshot_id` text NOT NULL,
	`date` text NOT NULL,
	`source_value` text NOT NULL,
	`value` text NOT NULL,
	`status` text,
	`revision` text,
	PRIMARY KEY(`snapshot_id`, `date`),
	FOREIGN KEY (`snapshot_id`) REFERENCES `benchmark_snapshots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `benchmark_observation_date` ON `benchmark_observations` (`date`,`snapshot_id`);--> statement-breakpoint
CREATE TABLE `benchmark_publications` (
	`series` text NOT NULL,
	`generation` integer NOT NULL,
	`snapshot_id` text NOT NULL,
	PRIMARY KEY(`series`, `generation`),
	FOREIGN KEY (`series`) REFERENCES `benchmark_heads`(`series`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`snapshot_id`) REFERENCES `benchmark_snapshots`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "generation_positive" CHECK("benchmark_publications"."generation" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `benchmark_publications_snapshot_id_unique` ON `benchmark_publications` (`snapshot_id`);--> statement-breakpoint
CREATE TABLE `benchmark_runs` (
	`id` text NOT NULL,
	`series` text NOT NULL,
	`checked_at` text NOT NULL,
	`outcome` text NOT NULL,
	`phase` text NOT NULL,
	`snapshot_id` text,
	`latest_date` text,
	PRIMARY KEY(`id`, `series`),
	CONSTRAINT "run_outcome" CHECK("benchmark_runs"."outcome" IN ('updated','unchanged','empty','failed')),
	CONSTRAINT "run_phase" CHECK("benchmark_runs"."phase" IN ('acquire','publish','complete'))
);
--> statement-breakpoint
CREATE TABLE `benchmark_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`series` text NOT NULL,
	`derivation` text NOT NULL,
	`artifact_key` text NOT NULL,
	`source_hash` text NOT NULL,
	`captured_at` text NOT NULL,
	`ingested_at` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`observation_count` integer NOT NULL,
	`decoder` text NOT NULL,
	FOREIGN KEY (`series`) REFERENCES `benchmark_heads`(`series`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "observation_bound" CHECK("benchmark_snapshots"."observation_count" BETWEEN 0 AND 366),
	CONSTRAINT "decoder_version" CHECK("benchmark_snapshots"."decoder" = 'benchmark-v1')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `benchmark_snapshots_derivation_unique` ON `benchmark_snapshots` (`derivation`);--> statement-breakpoint
CREATE INDEX `benchmark_snapshot_series` ON `benchmark_snapshots` (`series`,`captured_at`);