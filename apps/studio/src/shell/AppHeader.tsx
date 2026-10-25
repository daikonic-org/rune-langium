// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
/**
 * AppHeader — the single shell-level top bar, mounted once above
 * PerspectiveHost. Replaces Explore's private `studio-topbar` and App's
 * not-in-Explore brand header (see
 * docs/superpowers/specs/2026-07-03-shared-perspective-chrome-design.md).
 *
 * Composition: left brand+switcher (degradable), the active perspective's
 * centerSlot or title, its actions slot, then global utilities.
 *
 * Left brand/switcher + global utilities (GlobalSearch, SyncStatusBadge,
 * FontScaleButton, Avatar) MOVED VERBATIM from ExplorePerspective's private
 * header (Task 3 of the shared-chrome plan). Reads workspace state through
 * the null-tolerant hooks so it renders without throwing when no workspace
 * is loaded (Settings, or the launcher before a workspace opens).
 */
import { useCallback, useState, useSyncExternalStore } from 'react';
import { ChevronDown, Plus, LogOut, MoreHorizontal } from 'lucide-react';
import { Button } from '@rune-langium/design-system/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@rune-langium/design-system/ui/popover';
import { GlobalSearch } from './GlobalSearch.js';
import { Avatar, AvatarFallback } from '@rune-langium/design-system/ui/avatar';
import { usePerspectiveStore } from '../store/perspective-store.js';
import { PERSPECTIVES, resolveEffectivePerspective } from './perspectives/perspective-registry.js';
import { useWorkspaceOptional } from './providers/workspace-context.js';
import { useWorkspaceActionsOptional } from './perspectives/workspace-actions-context.js';
import { useExploreFileNavStore } from './explore-file-nav-store.js';
import { SyncStatusBadge } from '../components/SyncStatusBadge.js';
import { FontScaleButton } from '../components/FontScaleButton.js';
import { listRecents, type RecentWorkspaceRecord } from '../workspace/persistence.js';
import { resolveConflict } from '../services/git-sync.js';
import { withInstrumentation } from '../services/instrumentation/core.js';
import { useDesignPreviewStore } from '../store/design-preview-store.js';
import brandLogo from '../assets/rune-studio-logo.svg';

function subscribeHeaderWidth(listener: () => void) {
  window.addEventListener('resize', listener);
  return () => window.removeEventListener('resize', listener);
}

function compactHeaderWidth() {
  return window.innerWidth;
}

function WorkspaceSwitcherTrigger({
  workspaceName,
  workspaceFileCount,
  onSwitchWorkspace,
  onCreateWorkspace,
  onClose,
  workspaceId
}: {
  workspaceName: string | undefined;
  workspaceFileCount: number;
  onSwitchWorkspace: ((workspaceId: string) => void) | undefined;
  onCreateWorkspace: (() => void) | undefined;
  onClose: (() => void) | undefined;
  workspaceId: string;
}) {
  const [workspaceMenuRecents, setWorkspaceMenuRecents] = useState<RecentWorkspaceRecord[]>([]);
  const name = workspaceName || 'Untitled workspace';
  const initial = name.trim().charAt(0).toUpperCase();
  const fileCountLabel = `${workspaceFileCount} file${workspaceFileCount === 1 ? '' : 's'}`;
  const handleWorkspaceMenuOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        void listRecents().then((rows) => {
          setWorkspaceMenuRecents(rows.filter((r) => r.id !== workspaceId));
        });
      }
    },
    [workspaceId]
  );

  return (
    <Popover onOpenChange={handleWorkspaceMenuOpenChange}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="studio-topbar__ws-btn"
            aria-label={`Workspace menu — ${initial} ${name} ${fileCountLabel}`}
            title="Switch / create / close workspace"
          >
            <span className="studio-topbar__ws-mark" aria-hidden="true">
              {initial}{' '}
            </span>
            <span className="studio-topbar__ws-name">{name} </span>
            <span className="studio-topbar__ws-sub">{fileCountLabel}</span>
            <ChevronDown className="size-3" />
          </button>
        }
      />
      <PopoverContent align="start" sideOffset={6} className="w-72 p-1.5">
        {/* Switch-to section — only shown when callback is provided AND
            there are recents OTHER than the current workspace. */}
        {onSwitchWorkspace && workspaceMenuRecents.length > 0 && (
          <>
            <p className="px-2 py-1 text-3xs font-medium text-muted-foreground uppercase tracking-wider">Switch to</p>
            <ul className="space-y-0.5" role="menu">
              {workspaceMenuRecents.slice(0, 6).map((r) => (
                <li key={r.id} role="none">
                  <button
                    type="button"
                    role="menuitem"
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-accent/50 cursor-pointer text-left"
                    onClick={() => onSwitchWorkspace(r.id)}
                  >
                    <span className="font-medium truncate flex-1">{r.name}</span>
                    <span className="shrink-0 text-3xs px-1.5 py-0.5 rounded border border-border text-muted-foreground uppercase tracking-wide">
                      {r.kind === 'git-backed' ? 'GIT' : r.kind === 'folder-backed' ? 'FOLDER' : 'BROWSER'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="my-1 border-t border-border" />
          </>
        )}
        {onCreateWorkspace && (
          <button
            type="button"
            role="menuitem"
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-accent/50 cursor-pointer text-left"
            onClick={onCreateWorkspace}
          >
            <Plus className="size-3.5 text-muted-foreground" />
            <span>New workspace</span>
          </button>
        )}
        {onClose && (
          <button
            type="button"
            role="menuitem"
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-accent/50 cursor-pointer text-left text-destructive"
            onClick={onClose}
            aria-label={`Close ${workspaceName || 'workspace'} and return to start page`}
          >
            <LogOut className="size-3.5" />
            <span>Close workspace</span>
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

interface AppHeaderProps {
  /** Forwarded from App.tsx — same values PerspectiveHost receives, so both
   *  consume `resolveEffectivePerspective` identically and can never
   *  disagree about which perspective is actually showing (PR #369). */
  hasWorkspace: boolean;
  hasExploreContent: boolean;
}

export const AppHeader = withInstrumentation(
  function AppHeader({ hasWorkspace, hasExploreContent }: AppHeaderProps) {
    const accountInitials = 'PM';
    const activeId = usePerspectiveStore((s) => s.activePerspective);
    const effectiveId = resolveEffectivePerspective(activeId, { hasWorkspace, hasExploreContent });
    const perspective = PERSPECTIVES.find((p) => p.id === effectiveId);
    const Center = perspective?.centerSlot;
    const Actions = perspective?.actions;

    const workspace = useWorkspaceOptional();
    const workspaceActions = useWorkspaceActionsOptional();
    const syncStatus = useExploreFileNavStore((s) => s.syncStatus);
    const compareHeader = useDesignPreviewStore((state) => state.preferences.header);
    const headerWidth = useSyncExternalStore(subscribeHeaderWidth, compactHeaderWidth, () => 1280);
    const overflowActions = (compareHeader && headerWidth <= 1100) || (effectiveId === 'explore' && headerWidth <= 640);

    // Degrade rule: hide the switcher when there's no workspace loaded, or the
    // active perspective doesn't need one (Settings) — brand + title + global
    // utilities remain either way.
    const showSwitcher = workspace !== null && workspaceActions !== null && (perspective?.requiresWorkspace ?? false);

    return (
      <header className="studio-topbar" aria-label="Studio workspace header" data-testid="app-header">
        <div className="studio-topbar__left">
          <div className="studio-brand">
            <img className="studio-brand__mark" src={brandLogo} alt="" width={26} height={26} draggable={false} />
            <span className="studio-brand__name">Rune Studio</span>
          </div>
          {showSwitcher && workspace && workspaceActions && (
            <>
              <span className="studio-topbar__divider" />
              <WorkspaceSwitcherTrigger
                workspaceName={workspace.workspaceName}
                workspaceFileCount={workspace.fileCount}
                onSwitchWorkspace={workspaceActions.onSwitchWorkspace}
                onCreateWorkspace={workspaceActions.onCreateWorkspace}
                onClose={workspaceActions.onClose}
                workspaceId={workspace.workspaceId ?? 'default'}
              />
            </>
          )}
        </div>
        {/* Perspective title now lives in the chrome row below (PerspectiveHeading);
            keep an empty center cell so the topbar grid stays balanced. */}
        <div className="studio-topbar__center contents">
          {Center ? <Center /> : <div className="studio-topbar__title" aria-hidden="true" />}
        </div>
        <div className="studio-topbar__right">
          {Actions ? (
            overflowActions ? (
              <Popover>
                <PopoverTrigger
                  render={
                    <Button variant="ghost" size="icon-sm" aria-label="Workspace actions" title="Workspace actions" />
                  }
                >
                  <MoreHorizontal className="size-3.5" />
                </PopoverTrigger>
                <PopoverContent align="end" className="w-auto">
                  <div className="flex items-center gap-2" role="group" aria-label="Workspace actions">
                    <Actions />
                  </div>
                </PopoverContent>
              </Popover>
            ) : (
              <Actions />
            )
          ) : null}
          <GlobalSearch hasWorkspace={hasWorkspace} hasExploreContent={hasExploreContent} />
          {workspace?.workspaceKind === 'git-backed' && syncStatus && (
            <SyncStatusBadge
              status={syncStatus}
              onResolve={(choice) => {
                resolveConflict(workspace.workspaceId ?? 'default', choice);
              }}
            />
          )}
          <span className="studio-topbar__divider" />
          <FontScaleButton />
          <span className="studio-topbar__divider" />
          <Avatar
            render={<button type="button" aria-label={`${accountInitials} account`} />}
            className="size-7 cursor-pointer"
          >
            <AvatarFallback className="bg-linear-to-br from-enum to-data text-primary-foreground text-2xs font-bold">
              {accountInitials}
            </AvatarFallback>
          </Avatar>
        </div>
      </header>
    );
  },
  { op: 'AppHeader' }
);
