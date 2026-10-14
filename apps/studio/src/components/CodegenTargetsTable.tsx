// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * Landing-state table for the code-preview panel (018 Phase 0 Task 0.7).
 *
 * Renders all targets from {@link TARGET_DESCRIPTORS} as rows. The action
 * affordance follows the emitter contract:
 *   - `contract === 'namespace'` (zod, typescript, json-schema, sql, markdown)
 *     → two icon buttons: View (eye) + Download (arrow)
 *   - `contract === 'whole-model'` (excel, graphql) → Download only
 *
 * The component is intentionally presentational: callers pass `onView` /
 * `onDownload` plus an optional `inflightTarget` to swap that row's
 * action buttons for a spinner, and `activeTarget` to mark a row as
 * currently expanded. State coordination lives in `CodePreviewPanel`
 * (Task 0.8); this file stays trivially testable as pure props.
 */

import React from 'react';
import { IMPLEMENTED_TARGETS, TARGET_DESCRIPTORS, type Target } from '@rune-langium/codegen/export';
import { Button } from '@rune-langium/design-system/ui/button';
import { Spinner } from '@rune-langium/design-system/ui/spinner';
import { Eye, RotateCw, Download } from 'lucide-react';
import { withInstrumentation } from '../services/instrumentation/core.js';

export interface CodegenTargetsTableProps {
  /** Called when the user clicks the View (eye) button on a namespace-contract row. */
  onView: (target: Target) => void;
  /** Called when the user clicks the Download button on any row. */
  onDownload: (target: Target) => void;
  /**
   * If set, that target's row replaces its action buttons with a spinner
   * to indicate codegen is in flight for it.
   */
  inflightTarget?: Target;
  /**
   * If set, that target's row is marked as "active" — its preview is
   * currently expanded below the table. The View icon flips to
   * "currently visible" so its action clearly reads as regeneration.
   */
  activeTarget?: Target;
}

// 018 Task 0.7 follow-up — only render rows for targets whose emitter
// is registered in the codegen package. Phase 1/2/3 commits will extend
// `IMPLEMENTED_TARGETS` as sql/markdown/excel/graphql emitters land, at
// which point those rows appear automatically. Until then the table
// would show targets that short-circuit to a `not-implemented`
// diagnostic — confusing for users.
//
// Order is preserved from TARGET_DESCRIPTORS (the spec's declared
// order), filtered through the implemented set, rather than from
// IMPLEMENTED_TARGETS itself (which is keyed by EMITTER_CLASSES
// declaration order — an implementation detail that could change).
const TARGET_KEYS = (Object.keys(TARGET_DESCRIPTORS) as Target[]).filter((t) =>
  IMPLEMENTED_TARGETS.includes(t)
) as readonly Target[];

export const CodegenTargetsTable = withInstrumentation(
  function CodegenTargetsTable({
    onView,
    onDownload,
    inflightTarget,
    activeTarget
  }: CodegenTargetsTableProps): React.ReactElement {
    return (
      <div
        data-testid="codegen-targets-table"
        className="preview-panel__targets-table studio-scroll flex flex-col overflow-auto"
      >
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 border-b border-border/70 bg-card/40 text-left text-3xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-1.5 font-semibold">
                Target
              </th>
              <th scope="col" className="px-3 py-1.5 text-right font-semibold">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {TARGET_KEYS.map((target) => {
              const descriptor = TARGET_DESCRIPTORS[target];
              const isLoading = inflightTarget === target;
              const isActive = activeTarget === target;
              const canView = descriptor.contract === 'namespace';
              return (
                <tr
                  key={target}
                  data-testid={`codegen-targets-table__row-${target}`}
                  data-target={target}
                  data-contract={descriptor.contract}
                  data-active={isActive ? 'true' : undefined}
                  className={
                    'border-b border-border/70 transition-colors last:border-b-0 hover:bg-accent ' +
                    (isActive ? 'bg-accent/60' : '')
                  }
                >
                  <td className="px-3 py-1.5 font-medium text-foreground">{descriptor.label}</td>
                  <td className="px-3 py-1.5 text-right">
                    {isLoading ? (
                      <Spinner data-testid={`codegen-targets-table__spinner-${target}`} className="ml-auto size-4" />
                    ) : (
                      <div className="flex justify-end gap-0.5">
                        {canView ? (
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            aria-label={
                              isActive ? `Regenerate ${descriptor.label} preview` : `View ${descriptor.label}`
                            }
                            aria-pressed={isActive}
                            title={isActive ? `Regenerate ${descriptor.label} preview` : `View ${descriptor.label}`}
                            data-testid={`codegen-targets-table__view-${target}`}
                            onClick={() => onView(target)}
                          >
                            {isActive ? (
                              <RotateCw className="size-4" aria-hidden="true" />
                            ) : (
                              <Eye className="size-4" aria-hidden="true" />
                            )}
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Download ${descriptor.label}`}
                          title={`Download ${descriptor.label}`}
                          data-testid={`codegen-targets-table__download-${target}`}
                          onClick={() => onDownload(target)}
                        >
                          <Download className="size-4" aria-hidden="true" />
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  },
  { op: 'CodegenTargetsTable' }
);
