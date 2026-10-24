// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * GitSyncPerspective — full-height sidebar screen for git sync state.
 *
 * When the active workspace is git-backed (workspaceKind === 'git-backed'),
 * subscribes to the sync engine for `workspaceId` via `subscribeToEngine` and
 * renders `SyncStatusBadge` plus a contextual summary.
 *
 * When the workspace is NOT git-backed (or workspaceId / workspaceKind are
 * absent), shows an empty state explaining how to connect.
 *
 * `workspaceId` and `workspaceKind` are forwarded by PerspectiveHost from
 * EditorPage props (present-tense wiring — no zustand store needed).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { ReactElement } from 'react';
import type { SyncStatus } from '@rune-langium/git-sync-engine';
import type { WorkspaceKind } from '../../../workspace/persistence.js';
import { subscribeToEngine, resolveConflict, getSyncEngine } from '../../../services/git-sync.js';
import { SyncStatusBadge } from '../../../components/SyncStatusBadge.js';
import { Button } from '@rune-langium/design-system/ui/button';
import { useWorkspaceActionsOptional } from '../workspace-actions-context.js';
import { GitBranch } from 'lucide-react';
import { withInstrumentation } from '../../../services/instrumentation/core.js';

export interface GitSyncPerspectiveProps {
  /**
   * The active workspace id — must be provided for a git-backed workspace so
   * `subscribeToEngine` can subscribe to the right engine instance.
   * Forwarded by PerspectiveHost from EditorPage.
   */
  workspaceId?: string;
  /**
   * The workspace kind — determines whether to show the sync UI or the
   * "not git-backed" empty state.
   * Forwarded by PerspectiveHost from EditorPage.
   */
  workspaceKind?: WorkspaceKind;
}

function GitNotConnectedEmptyState(): ReactElement {
  return (
    <div
      data-testid="git-not-connected"
      className="flex flex-col items-center justify-center gap-4 px-6 py-16 text-center"
    >
      <GitBranch className="size-10 text-muted-foreground/40" aria-hidden="true" />
      <h2 className="text-sm font-semibold text-foreground">Not connected to Git</h2>
      <p className="max-w-[24rem] text-xs text-muted-foreground">
        This workspace isn&apos;t connected to a Git repository. Connect a GitHub repo from <strong>Workspaces</strong>{' '}
        to enable sync.
      </p>
    </div>
  );
}

export const GitSyncPerspective = withInstrumentation(
  function GitSyncPerspective({ workspaceId, workspaceKind }: GitSyncPerspectiveProps): ReactElement {
    const isGitBacked = workspaceKind === 'git-backed' && !!workspaceId;

    const actions = useWorkspaceActionsOptional();
    const [working, setWorking] = useState(false);
    const [error, setError] = useState<string>();
    const activeId = useRef(workspaceId);
    useEffect(() => {
      activeId.current = workspaceId;
      return () => {
        activeId.current = undefined;
      };
    }, [workspaceId]);
    const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);

    // Reset on workspace switch — adjusted during render (React's blessed
    // pattern) rather than in the subscription effect below, so stale status
    // never even paints for one frame before the effect's cleanup/resubscribe
    // would otherwise correct it.
    //
    // Tracked via useState, NOT plain refs: a ref mutation made during render
    // is not rolled back if React discards/retries this render under
    // concurrent rendering, while the accompanying setSyncStatus(null) call IS
    // rolled back (it never committed) — so a bare `.current = ...` assignment
    // could leave the retry believing this workspace switch was already
    // handled and skip the reset, painting the previous workspace's status
    // until (if ever) subscribeToEngine happens to correct it (Codex review).
    const [prevIsGitBacked, setPrevIsGitBacked] = useState(isGitBacked);
    const [prevWorkspaceId, setPrevWorkspaceId] = useState(workspaceId);
    if (isGitBacked && workspaceId && (isGitBacked !== prevIsGitBacked || workspaceId !== prevWorkspaceId)) {
      setSyncStatus(null);
    }
    if (isGitBacked !== prevIsGitBacked) setPrevIsGitBacked(isGitBacked);
    if (workspaceId !== prevWorkspaceId) setPrevWorkspaceId(workspaceId);

    useEffect(() => {
      if (!isGitBacked || !workspaceId) return;
      return subscribeToEngine(workspaceId, setSyncStatus);
    }, [isGitBacked, workspaceId]);

    const handleResolve = useCallback(
      (choice: 'keepMine' | 'takeRemote') => {
        if (workspaceId) resolveConflict(workspaceId, choice);
      },
      [workspaceId]
    );

    return (
      <section data-testid="git-perspective" className="studio-scroll h-full overflow-auto p-6 space-y-6">
        {!isGitBacked ? (
          <GitNotConnectedEmptyState />
        ) : (
          <div className="space-y-4">
            {/* Live sync status badge */}
            <div data-testid="git-sync-status-row" className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground shrink-0">Status</span>
              {syncStatus ? (
                <SyncStatusBadge status={syncStatus} onResolve={handleResolve} />
              ) : (
                <span className="text-xs text-muted-foreground" data-testid="git-sync-initialising">
                  Initialising…
                </span>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Save updates your local working copy. Commit and push publishes changes to this repository.
              </p>
              <Button
                size="sm"
                disabled={
                  working ||
                  !syncStatus ||
                  syncStatus.conflictPaths !== undefined ||
                  ['committing', 'fetching', 'merging', 'pushing'].includes(syncStatus.phase)
                }
                onClick={async () => {
                  if (!workspaceId) return;
                  setWorking(true);
                  setError(undefined);
                  try {
                    await actions?.flushWorkspaceSave?.();
                    if (activeId.current !== workspaceId) return;
                    const engine = getSyncEngine(workspaceId);
                    if (!engine) throw new Error('Git is still initializing. Try again.');
                    await engine.syncNow();
                  } catch (cause) {
                    if (activeId.current === workspaceId)
                      setError(
                        cause instanceof Error
                          ? cause.message
                          : 'Commit and push could not finish. Retry when access is restored.'
                      );
                  } finally {
                    setWorking(false);
                  }
                }}
              >
                Commit and push
              </Button>
              {error && (
                <p role="alert" className="text-xs text-destructive">
                  {error}
                </p>
              )}
            </div>
            {/* Sync summary — ahead / behind counts when available */}
            {syncStatus && (syncStatus.ahead > 0 || syncStatus.behind > 0) && (
              <div
                data-testid="git-sync-summary"
                className="rounded-md border border-border/60 bg-card/50 px-3 py-2 text-xs text-muted-foreground space-y-0.5"
              >
                {syncStatus.ahead > 0 && (
                  <p>
                    <span className="font-medium text-foreground">{syncStatus.ahead}</span> local commit
                    {syncStatus.ahead !== 1 ? 's' : ''} ahead of remote
                  </p>
                )}
                {syncStatus.behind > 0 && (
                  <p>
                    <span className="font-medium text-foreground">{syncStatus.behind}</span> remote commit
                    {syncStatus.behind !== 1 ? 's' : ''} not yet pulled
                  </p>
                )}
              </div>
            )}

            {/* Conflict paths — listed when a merge conflict is pending */}
            {syncStatus?.conflictPaths && syncStatus.conflictPaths.length > 0 && (
              <div
                data-testid="git-conflict-paths"
                className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 space-y-1"
              >
                <p className="text-xs font-medium text-amber-500">Conflicting files</p>
                <ul className="space-y-0.5">
                  {syncStatus.conflictPaths.map((path) => (
                    <li key={path} className="text-2xs font-mono text-muted-foreground">
                      {path}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>
    );
  },
  { op: 'GitSyncPerspective' }
);
