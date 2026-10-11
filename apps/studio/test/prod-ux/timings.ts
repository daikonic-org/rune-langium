// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import type { JourneyRecord } from './evidence.js';

/**
 * Soft wall-clock budgets per operation, taken directly from spec §4's
 * timings table. Exceeding a budget marks the journey DEGRADED, never
 * FAIL — only a journey's own hard assertions can fail it.
 * Note: cdmLoad renamed to modelLoad to match the real op-log instrumentation
 * emitted by model-store.ts (which instruments as op: 'modelLoad', subject: 'cdm').
 */
export const TIMING_BUDGETS: Record<string, number> = {
  startPageInteractive: 5000,
  workspaceOpen: 5000,
  modelLoad: 45000,
  hydration: 10000,
  typeClosureWalk: 60000,
  formRender: 5000,
  functionExecute: 10000,
  codegen: 15000,
  importPreview: 10000,
  importMerge: 10000,
  reloadRestore: 8000
};

export interface TimingRecord {
  op: string;
  subject: string | null;
  ms: number;
  budgetMs: number;
}

/**
 * Rolls every journey's opLog entries into one manifest-level timings table
 * (spec §4 shape). Only entries whose `op` has a known budget and a
 * recorded `durationMs` are included — unbudgeted or not-yet-instrumented
 * ops are silently omitted, matching spec §6's "the harness degrades
 * gracefully to test-side stopwatches without it."
 */
export function buildTimingsRollup(journeys: readonly JourneyRecord[]): TimingRecord[] {
  const timings: TimingRecord[] = [];
  for (const journey of journeys) {
    const seenOperations = new Set<string>();
    // Negative IDs belong to the collector's end-to-end measurements. Prefer
    // those over internal spans such as the synchronous model registration.
    const measuredOps = new Set(
      journey.opLog.filter((entry) => entry.panel === 'perf' && entry.sourceId < 0).map((entry) => entry.op)
    );
    for (const entry of journey.opLog) {
      if (measuredOps.has(entry.op) && !(entry.panel === 'perf' && entry.sourceId < 0)) continue;
      const budgetMs = TIMING_BUDGETS[entry.op];
      if (budgetMs === undefined || entry.durationMs === undefined) continue;
      if (entry.opId !== undefined) {
        const identity = `${entry.navigationGeneration ?? 0}:${entry.op}:${entry.opId}`;
        if (seenOperations.has(identity)) continue;
        seenOperations.add(identity);
      }
      timings.push({ op: entry.op, subject: entry.subject ?? null, ms: entry.durationMs, budgetMs });
    }
  }
  return timings;
}

/** True if any entry in a single journey's own opLog exceeded its op's budget. */
export function exceedsBudget(opLog: readonly { op: string; durationMs?: number }[]): boolean {
  return opLog.some((entry) => {
    const budgetMs = TIMING_BUDGETS[entry.op];
    return budgetMs !== undefined && entry.durationMs !== undefined && entry.durationMs > budgetMs;
  });
}
