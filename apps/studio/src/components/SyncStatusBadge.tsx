// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * SyncStatusBadge — compact topbar chip for the live git-sync state.
 *
 * - idle:    subtle "Synced" indicator
 * - syncing (committing/fetching/merging/pushing): spinner + "Syncing…"
 * - offline:  muted "Offline — retry in Git / Sync"
 * - blocked + conflictPaths: amber warning + Keep mine / Take remote buttons
 * - blocked without conflictPaths: amber warning with an informative
 *   message (auth / no_push_access / non_fast_forward) and NO resolve
 *   buttons — those reasons have no pending promise to fulfil.
 *
 * Props are passed in (not subscribed internally) so the parent can own
 * the subscription lifetime and the badge remains a pure rendering leaf.
 */

import type { ReactElement } from 'react';
import type { SyncStatus } from '@rune-langium/git-sync-engine';
import { Spinner } from '@rune-langium/design-system/ui/spinner';
import { Button } from '@rune-langium/design-system/ui/button';
import { Check, WifiOff, AlertTriangle, CircleDot } from 'lucide-react';
import { withInstrumentation } from '../services/instrumentation/core.js';

const SYNCING_PHASES = new Set(['committing', 'fetching', 'merging', 'pushing']);

type SyncErrorCode = NonNullable<SyncStatus['lastError']>['code'];

/**
 * Human-readable message for a `blocked` phase that is NOT a merge conflict.
 * These cases have no pending ConflictPolicy.onConflict promise, so resolve
 * buttons would be a silent no-op — surface an informative message instead.
 */
function blockedErrorMessage(code: SyncErrorCode | undefined): string {
  switch (code) {
    case 'auth':
      return 'Sign-in expired — reconnect to GitHub';
    case 'no_push_access':
      return 'No push access to this repository';
    case 'non_fast_forward':
      return "Remote moved — couldn't push";
    default:
      return "Couldn't sync";
  }
}

export interface SyncStatusBadgeProps {
  status: SyncStatus;
  onResolve: (choice: 'keepMine' | 'takeRemote') => void;
}

export const SyncStatusBadge = withInstrumentation(
  function SyncStatusBadge({ status, onResolve }: SyncStatusBadgeProps): ReactElement {
    const { phase } = status;

    if (SYNCING_PHASES.has(phase)) {
      return (
        <span
          data-testid="sync-status"
          data-phase={phase}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground"
        >
          <Spinner className="size-3" />
          Syncing…
        </span>
      );
    }

    if (phase === 'offline') {
      return (
        <span
          data-testid="sync-status"
          data-phase={phase}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground"
        >
          <WifiOff className="size-3" />
          Offline — retry in Git / Sync
        </span>
      );
    }

    if (phase === 'blocked') {
      // The engine emits `blocked` for several reasons. A merge conflict —
      // including one where the conflicting file list is empty (unsupported-merge
      // path) — carries `conflictPaths` (defined, possibly []) AND has a pending
      // ConflictPolicy.onConflict promise that the resolve buttons must fulfil.
      // Other blocked reasons (auth, no_push_access, non_fast_forward) have
      // `conflictPaths === undefined`; showing resolve buttons there would leave
      // the engine stuck forever — surface an informative message instead.
      if (status.conflictPaths !== undefined) {
        const conflictMsg =
          status.conflictPaths.length > 0
            ? 'Merge conflict — choose a resolution'
            : "Couldn't auto-merge — choose a resolution";
        return (
          <span
            data-testid="sync-status"
            data-phase={phase}
            className="inline-flex items-center gap-1.5 text-xs text-amber-500"
          >
            <AlertTriangle className="size-3 shrink-0" />
            <span>{conflictMsg}</span>
            <Button
              type="button"
              variant="outline"
              size="xs"
              data-testid="sync-resolve-keep-mine"
              onClick={() => onResolve('keepMine')}
              className="h-5 px-1.5 text-3xs"
            >
              Keep mine
            </Button>
            <Button
              type="button"
              variant="outline"
              size="xs"
              data-testid="sync-resolve-take-remote"
              onClick={() => onResolve('takeRemote')}
              className="h-5 px-1.5 text-3xs"
            >
              Take remote
            </Button>
          </span>
        );
      }

      return (
        <span
          data-testid="sync-status"
          data-phase={phase}
          className="inline-flex items-center gap-1.5 text-xs text-amber-500"
        >
          <AlertTriangle className="size-3 shrink-0" />
          <span>{blockedErrorMessage(status.lastError?.code)}</span>
        </span>
      );
    }

    if (status.dirty)
      return (
        <span
          data-testid="sync-status"
          data-phase={phase}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground"
        >
          <CircleDot className="size-3" aria-hidden="true" />
          Changes to commit
        </span>
      );
    if (status.ahead || status.behind)
      return (
        <span data-testid="sync-status" data-phase={phase} className="text-xs text-muted-foreground">
          {status.ahead ? 'Commits to push' : 'Remote changes'}
        </span>
      );
    // idle — quiet success indicator
    return (
      <span
        data-testid="sync-status"
        data-phase={phase}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground"
      >
        <Check className="size-3 text-success" />
        Synced
      </span>
    );
  },
  { op: 'SyncStatusBadge' }
);
