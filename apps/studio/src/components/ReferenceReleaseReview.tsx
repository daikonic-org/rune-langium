// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import type { BuildConfig, ProjectLock, ProjectDiagnostic } from '@rune-langium/project-config';
import { Button } from '@rune-langium/design-system/ui/button';
import { withInstrumentation } from '../services/instrumentation/core.js';

export const ReferenceReleaseReview = withInstrumentation(
  function ReferenceReleaseReview({
    config,
    lock,
    diagnostics,
    previous,
    busy,
    onAccept,
    onCancel
  }: {
    config: BuildConfig;
    lock: ProjectLock;
    diagnostics: readonly ProjectDiagnostic[];
    previous?: ProjectLock;
    busy: boolean;
    onAccept: () => void;
    onCancel: () => void;
  }) {
    return (
      <section className="space-y-3 w-full" aria-labelledby="reference-review-title">
        <h3 id="reference-review-title">Review reference change</h3>
        <p>
          These releases replace the active reference closure only after Save succeeds. Changed types and function
          signatures may require updates to local overrides, examples and workflows.
        </p>
        <ul className="space-y-2 text-xs" aria-label="Proposed reference releases">
          {Object.entries(lock.references).map(([id, release]) => {
            const direct = Object.prototype.hasOwnProperty.call(config.references, id);
            const requiredBy = Object.entries(lock.references)
              .filter(([, entry]) => Object.prototype.hasOwnProperty.call(entry.dependencies, id))
              .map(([parent]) => parent);
            const old = previous?.references[id]?.release;
            return (
              <li key={id} className="rounded border p-2 break-words">
                <strong>{id}</strong> <span>{release.release}</span>
                <p className="text-muted-foreground">
                  {direct ? 'Selected dependency' : `Required by ${requiredBy.join(', ')}`}
                  {old && old !== release.release
                    ? ` · Changes ${old} → ${release.release}`
                    : old
                      ? ' · Unchanged'
                      : ''}
                </p>
              </li>
            );
          })}
          {Object.keys(previous?.references ?? {})
            .filter((id) => !Object.prototype.hasOwnProperty.call(lock.references, id))
            .map((id) => (
              <li key={id}>{id} · Removed from this closure</li>
            ))}
        </ul>
        {diagnostics.map((issue, index) => (
          <p key={index} role="alert" className="break-words">
            <code>{issue.path}</code> · {issue.code}: {issue.message}
          </p>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={busy || diagnostics.some((issue) => issue.severity === 'error')}
            onClick={onAccept}
          >
            {busy ? 'Saving…' : 'Save reference change'}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
            Cancel review
          </Button>
        </div>
      </section>
    );
  },
  {
    op: 'ReferenceReleaseReview',
    capture: 0,
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);
