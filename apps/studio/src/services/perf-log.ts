// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { withInstrumentation, Capture } from './instrumentation/core.js';

/**
 * High-frequency operation timing (a debounced reparse, a workspace
 * autosave — anything that can fire once per keystroke) that has no
 * business rendering in the user-visible Activity/Output panels
 * (op-log.ts): those panels have a 200-entry ring buffer meant for
 * infrequent, meaningful events (LSP connect, model load, a toast), and
 * flooding them with one row per keystroke evicts exactly the entries
 * that ring buffer exists to keep. Kept in its own capped buffer instead,
 * exposed read-only via `window.__runeStudioPerfLog`
 * (perf-log-window-bridge.ts) so prod-ux journeys can poll real
 * completion timing instead of guessing a fixed wait, without touching
 * anything a user actually sees.
 */

export type PerfFailureReason =
  | 'cancelled'
  | 'timeout'
  | 'worker-failure'
  | 'revision-mismatch'
  | 'receipt-mismatch'
  | 'project-invalid';

export interface PerfLogEntry {
  op: string;
  subject?: string;
  ok: boolean;
  outcome?: 'success' | 'error' | 'cancelled';
  /** Structural diagnostics only; never model text or exception payloads. */
  reason?: PerfFailureReason;
  workspaceEpoch?: number;
  filesRevision?: number;
  durationMs: number;
  ts: number;
  opId: number;
}

const MAX_ENTRIES = 200;
let entries: PerfLogEntry[] = [];

/**
 * The opId most recently allocated for each `op`, updated synchronously
 * the moment the operation starts (before any await). A caller (e.g. a
 * prod-ux journey) that triggers an edit and immediately reads this can
 * learn exactly which opId corresponds to the operation IT triggered,
 * then wait for that exact opId to complete (`PerfLogEntry.opId` on the
 * matching snapshot entry) — the only race-free way to correlate a
 * specific edit to a specific completion when multiple instances of the
 * same op (e.g. several `workspaceSave` calls from rapid edits) can be in
 * flight and completing out of order.
 */
const lastStartedOpId = new Map<string, number>();

// `op` here is one of a fixed vocabulary of studio-defined operation tags
// (e.g. 'workspaceSave') set by call sites in this codebase — never
// user/model content — safe to capture verbatim, same as opId (a counter).
export const recordPerfStart = withInstrumentation(
  function recordPerfStart(op: string, opId: number): void {
    lastStartedOpId.set(op, opId);
  },
  {
    op: 'recordPerfStart',
    capture: Capture.Input,
    sanitize: (value, which) => {
      if (which !== 'input') return undefined;
      const [op, opId] = value as [string, number];
      return { op, opId };
    }
  }
);

export const getLastStartedOpId = withInstrumentation(
  function getLastStartedOpId(op: string): number | undefined {
    return lastStartedOpId.get(op);
  },
  {
    op: 'getLastStartedOpId',
    capture: Capture.Input | Capture.Output,
    sanitize: (value, which) => (which === 'input' ? { op: (value as [string])[0] } : value)
  }
);

// `entry.subject` is a free-form correlator that (like op-log.ts's
// OpLogEntry.subject) isn't always safe — see telemetry-shipper.ts's
// safeSubject commentary — so it's dropped here; `op`/`ok`/`durationMs`/
// `opId` are all studio-defined/structural and safe.
export const recordPerf = withInstrumentation(
  function recordPerf(entry: PerfLogEntry): void {
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
  },
  {
    op: 'recordPerf',
    capture: Capture.Input,
    sanitize: (value, which) => {
      if (which !== 'input') return undefined;
      const [entry] = value as [PerfLogEntry];
      return { op: entry.op, ok: entry.ok, outcome: entry.outcome, durationMs: entry.durationMs, opId: entry.opId };
    }
  }
);

// Same subject concern as recordPerf above — only capture the count, never
// the raw entries array.
export const getPerfLogSnapshot = withInstrumentation(
  function getPerfLogSnapshot(): PerfLogEntry[] {
    return entries;
  },
  {
    op: 'getPerfLogSnapshot',
    capture: Capture.Output,
    sanitize: (value, which) => (which === 'output' && Array.isArray(value) ? { count: value.length } : undefined)
  }
);
