// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/** Recent editable workspaces with backing, recency and recorded repository status. */

import { useEffect, useId, useState } from 'react';
import { Button } from '@rune-langium/design-system/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@rune-langium/design-system/ui/dialog';
import { Input } from '@rune-langium/design-system/ui/input';
import { Trash2, RefreshCw, Pencil } from 'lucide-react';
import {
  listRecents,
  loadWorkspace,
  renameWorkspace,
  type RecentWorkspaceRecord,
  type WorkspaceRecord
} from '../workspace/persistence.js';
import { withInstrumentation } from '../services/instrumentation/core.js';

interface Props {
  onOpen: (workspaceId: string) => void;
  onCreate: () => void;
  onDelete: (workspaceId: string) => void;
  onRename?: (workspaceId: string, name: string) => Promise<void>;
}

const KIND_LABEL: Record<RecentWorkspaceRecord['kind'], string> = {
  'browser-only': 'Browser only',
  'folder-backed': 'Folder',
  'git-backed': 'Git'
};

/**
 * Format a UTC ISO string as "5 minutes ago" / "yesterday" / "3 days ago".
 * Falls back to the locale date string for anything older than a week.
 * Kept dependency-free (no date-fns) — the recents list is small and
 * pluralization is the only complexity.
 */
function formatRelativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}

export const WorkspaceSwitcher = withInstrumentation(
  function WorkspaceSwitcher({
    onOpen,
    onCreate: _onCreate,
    onDelete,
    onRename = renameWorkspace
  }: Props): React.ReactElement {
    const [rows, setRows] = useState<RecentWorkspaceRecord[]>([]);
    const metadataId = useId();
    const [metadata, setMetadata] = useState<Record<string, WorkspaceRecord | undefined>>({});
    const [error, setError] = useState<string>(),
      [refresh, setRefresh] = useState(0),
      [loading, setLoading] = useState(true);
    const syncLabel = (row: RecentWorkspaceRecord) => {
      const workspace = metadata[row.id];
      if (!workspace) return 'Status unavailable';
      if (workspace.kind !== 'git-backed') return workspace.kind === 'folder-backed' ? 'Local folder' : 'No Git remote';
      const backing = workspace.gitBacking;
      if (backing.syncState === 'clean') return backing.lastSyncedSha ? 'Last sync recorded' : 'Sync not recorded';
      return { ahead: 'Not pushed', behind: 'Update available', diverged: 'Diverged', conflict: 'Conflict' }[
        backing.syncState
      ];
    };
    // Row awaiting delete confirmation — replaces the native window.confirm
    // with the design-system's animated Dialog for visual consistency.
    const [renaming, setRenaming] = useState<string>();
    const [name, setName] = useState('');
    const [savingName, setSavingName] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<RecentWorkspaceRecord | null>(null);

    useEffect(() => {
      let cancelled = false;
      setLoading(true);
      void listRecents()
        .then(async (rows) => {
          const records = await Promise.all(rows.map(async (row) => [row.id, await loadWorkspace(row.id)] as const));
          if (!cancelled) {
            setRows(rows);
            setMetadata(Object.fromEntries(records));
            setError(undefined);
            setLoading(false);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setError('Recent workspaces could not be read. Refresh to try again.');
            setMetadata({});
            setLoading(false);
          }
        });
      return () => {
        cancelled = true;
      };
    }, [refresh]);

    const saveName = async (id: string) => {
      if (!name.trim() || savingName) return;
      setSavingName(true);
      setError(undefined);
      try {
        await onRename(id, name.trim());
        setRenaming(undefined);
        setRefresh((value) => value + 1);
        requestAnimationFrame(() => document.getElementById(`${metadataId}-${id}-rename`)?.focus());
      } catch (error) {
        setError(error instanceof Error ? error.message : 'The workspace could not be renamed. Try again.');
      } finally {
        setSavingName(false);
      }
    };

    function confirmDelete(row: RecentWorkspaceRecord) {
      onDelete(row.id);
      setRows((rs) => rs.filter((r) => r.id !== row.id));
      setPendingDelete(null);
    }

    return (
      <section
        data-testid="workspace-switcher"
        className="studio-recent-workspaces"
        aria-labelledby={`${metadataId}-heading`}
      >
        <div className="studio-launcher__section-heading">
          <h2 id={`${metadataId}-heading`}>Recent workspaces</h2>
          <span>Stored on this device</span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Refresh recent workspaces"
            onClick={() => setRefresh((value) => value + 1)}
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {loading && (
          <p role="status" className="text-sm text-muted-foreground">
            Loading recent workspaces…
          </p>
        )}
        {rows.length === 0 && !loading && !error ? (
          <p data-testid="workspace-switcher-empty" className="text-sm text-muted-foreground">
            No recent workspaces — create one above to get started.
          </p>
        ) : (
          <ul className="studio-recent-workspaces__list studio-scroll" aria-label="Recent workspaces" tabIndex={0}>
            {rows.map((row) => (
              <li
                key={row.id}
                className="studio-fade-in"
                data-testid="workspace-row"
                data-id={row.id}
                data-kind={row.kind}
              >
                <div className="group relative flex min-w-0 items-center gap-2 px-2 py-2 border-b border-border text-sm hover:bg-accent/50 transition-colors">
                  {renaming === row.id ? (
                    <form
                      className="relative z-10 flex min-w-0 flex-1 flex-wrap items-center gap-1"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void saveName(row.id);
                      }}
                    >
                      <Input
                        autoFocus
                        aria-label="Workspace name"
                        value={name}
                        disabled={savingName}
                        className="min-w-24 flex-1"
                        onChange={(event) => setName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape' && !savingName) {
                            setRenaming(undefined);
                            document.getElementById(`${metadataId}-${row.id}-rename`)?.focus();
                          }
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void saveName(row.id);
                          }
                        }}
                      />
                      <Button type="submit" size="xs" disabled={!name.trim() || savingName}>
                        Save name
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        disabled={savingName}
                        onClick={() => {
                          setRenaming(undefined);
                          requestAnimationFrame(() =>
                            document.getElementById(`${metadataId}-${row.id}-rename`)?.focus()
                          );
                        }}
                      >
                        Cancel
                      </Button>
                    </form>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => onOpen(row.id)}
                        aria-labelledby={`${metadataId}-${row.id}-action ${metadataId}-${row.id}-name`}
                        aria-describedby={`${metadataId}-${row.id}`}
                        className="absolute inset-0 cursor-pointer rounded-md focus-visible:outline focus-visible:outline-ring"
                      >
                        <span id={`${metadataId}-${row.id}-action`} className="sr-only">
                          Open
                        </span>
                      </button>
                      <span
                        id={`${metadataId}-${row.id}-name`}
                        className="studio-recent-workspace__name pointer-events-none min-w-0 flex-1 truncate font-medium"
                      >
                        {row.name}
                      </span>
                      <span
                        id={`${metadataId}-${row.id}`}
                        className="studio-recent-workspace__metadata pointer-events-none contents"
                      >
                        <span className="shrink-0 text-3xs px-1.5 py-0.5 rounded border border-border text-muted-foreground uppercase tracking-wide">
                          {KIND_LABEL[row.kind]}
                        </span>{' '}
                        <span
                          className="shrink-0 text-xs text-muted-foreground"
                          title={
                            row.kind === 'browser-only'
                              ? 'Stored in this browser on this device; no Git remote.'
                              : 'Repository status recorded on this device'
                          }
                        >
                          {syncLabel(row)}
                        </span>{' '}
                        <span className="hidden sm:inline shrink-0 ml-auto text-xs text-muted-foreground">
                          {formatRelativeTime(row.lastOpenedAt)}
                        </span>
                      </span>
                    </>
                  )}
                  <Button
                    id={`${metadataId}-${row.id}-rename`}
                    variant="ghost"
                    size="icon-xs"
                    className="studio-recent-workspace__rename relative"
                    aria-label={`Rename ${row.name}`}
                    disabled={savingName}
                    onClick={() => {
                      setRenaming(row.id);
                      setName(row.name);
                      setError(undefined);
                    }}
                  >
                    <Pencil className="size-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={savingName || renaming === row.id}
                    className="studio-recent-workspace__delete relative size-5 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => setPendingDelete(row)}
                    aria-label={`Delete ${row.name}`}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <Dialog open={pendingDelete !== null} onOpenChange={(o) => !o && setPendingDelete(null)}>
          <DialogContent className="max-w-sm" data-testid="workspace-delete-dialog">
            <DialogHeader>
              <DialogTitle>Delete workspace?</DialogTitle>
              <DialogDescription>
                {pendingDelete
                  ? pendingDelete.kind === 'folder-backed'
                    ? `Disconnect ${pendingDelete.name} from this device. Its folder files are retained.`
                    : pendingDelete.kind === 'git-backed'
                      ? `Remove the browser working copy of ${pendingDelete.name}. The remote repository is unchanged.`
                      : `Delete ${pendingDelete.name} and its browser files. This cannot be undone.`
                  : ''}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="secondary" size="sm" onClick={() => setPendingDelete(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                data-testid="workspace-delete-confirm"
                onClick={() => pendingDelete && confirmDelete(pendingDelete)}
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </section>
    );
  },
  { op: 'WorkspaceSwitcher' }
);
