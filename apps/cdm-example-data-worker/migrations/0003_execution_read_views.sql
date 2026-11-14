CREATE VIEW `benchmark_data` AS SELECT s.series, o.snapshot_id, p.generation, o.date, o.source_value, o.value,
  s.captured_at, COALESCE(c.last_seen_at,s.captured_at) AS confirmed_at
  FROM benchmark_observations o JOIN benchmark_snapshots s ON s.id=o.snapshot_id
  JOIN benchmark_publications p ON p.snapshot_id=s.id
  JOIN benchmark_heads h ON h.series=p.series AND p.generation<=h.generation
  LEFT JOIN benchmark_confirmations c ON c.snapshot_id=s.id;--> statement-breakpoint
CREATE VIEW `sonia_ois_data` AS SELECT o.snapshot_id, p.generation, o.date, o.kind, o.grid, o.maturity_months,
  o.maturity_years, o.source_value, o.value, s.captured_at,
  COALESCE(c.last_seen_at,s.captured_at) AS confirmed_at
  FROM curve_points o JOIN curve_snapshots s ON s.id=o.snapshot_id
  JOIN curve_publications p ON p.snapshot_id=s.id
  JOIN curve_heads h ON h.series=p.series AND p.generation<=h.generation
  LEFT JOIN curve_confirmations c ON c.snapshot_id=s.id;