CREATE TABLE `benchmark_confirmations` (
	`snapshot_id` text PRIMARY KEY NOT NULL,
	`last_seen_at` text NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `benchmark_snapshots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
DROP INDEX `benchmark_snapshots_derivation_unique`;