// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * useDiagnosticsForRange — returns the highest-severity diagnostic whose
 * character-offset range overlaps the given `astRange`.
 *
 * Diagnostics are passed in as pre-converted character-offset ranges so
 * this hook stays decoupled from the LSP line/character format. The
 * conversion happens in EditorPage via a memoized lineOffsets array
 * (approach b from spec §3.4) before being threaded into StructureView.
 *
 * This is a pure computation wrapped in useMemo — no zustand subscriptions.
 * Consumers provide the diagnostics array; the hook does only range-overlap
 * filtering and severity ranking.
 */

import { useMemo } from 'react';

/**
 * A diagnostic whose range has been converted from LSP line/character
 * coordinates to character offsets in the source document. EditorPage
 * performs this conversion via a memoized lineOffsets array before passing
 * the resulting array into StructureView member rows.
 */
export interface RangeDiagnostic {
  readonly start: number;
  readonly end: number;
  readonly severity: 1 | 2 | 3 | 4;
  readonly message: string;
}

/**
 * Returns the highest-severity `RangeDiagnostic` whose range overlaps the
 * given `astRange`, or `undefined` when no overlap exists.
 *
 * Overlap semantics: two ranges `[a.start, a.end)` and `[b.start, b.end)`
 * overlap iff `a.start < b.end && b.start < a.end`. This matches the
 * standard half-open-interval definition used by CodeMirror and LSP.
 * Zero-length ranges (start === end) never overlap.
 *
 * Severity ordering: 1 (error) > 2 (warn) > 3 (info) > 4 (hint) — lower
 * numeric value wins.
 *
 * @param astRange  Character-offset span of the row being tested. When
 *                  `undefined`, returns `undefined` without inspecting the
 *                  diagnostics array (nothing to match against).
 * @param diagnostics  Pre-converted diagnostics for the active file.
 *                     Pass a stable empty array (`[]`) when there are none.
 */
export function useDiagnosticsForRange(
  astRange: { start: number; end: number } | undefined,
  diagnostics: readonly RangeDiagnostic[]
): RangeDiagnostic | undefined {
  return useMemo(() => {
    if (!astRange || diagnostics.length === 0) return undefined;
    const { start, end } = astRange;
    // Zero-length range — nothing to overlap.
    if (start >= end) return undefined;

    let best: RangeDiagnostic | undefined;
    for (const d of diagnostics) {
      // Half-open overlap: [d.start, d.end) ∩ [start, end) is non-empty
      // iff d.start < end && start < d.end.
      if (d.start < end && start < d.end) {
        if (!best || d.severity < best.severity) {
          best = d;
        }
      }
    }
    return best;
  }, [astRange, diagnostics]);
}

/**
 * Maps `RangeDiagnostic.severity` (LSP: 1=error, 2=warn, 3=info, 4=hint) to
 * the corresponding `rune-node-row--diagnostic-*` CSS modifier class.
 * Centralized so DataNode / ChoiceNode / future row consumers share one
 * mapping and stay consistent if severities or class names change.
 */
export function diagnosticSeverityClass(severity: 1 | 2 | 3 | 4): string {
  if (severity === 1) return 'rune-node-row--diagnostic-error';
  if (severity === 2) return 'rune-node-row--diagnostic-warn';
  return 'rune-node-row--diagnostic-info';
}
