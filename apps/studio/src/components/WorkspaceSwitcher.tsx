// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * WorkspaceSwitcher — recent-workspaces list backed by the persistence
 * `recents` IDB store. Distinguishes the three kinds visually via
 * `data-kind` so the design system can theme each independently.
 *
 * Visual contract (e2e-batch fix): matches the LOADED MODELS / REFERENCE
 * MODELS sections in ModelLoader so the start-page reads as one family of
 * sections. Each row is a clickable card with a kind badge + relative
 * "opened ago" timestamp. Without these treatments the row rendered as
 * unstyled plain text and users didn't realise it was navigable
 * (user-reported: "No way to navigate to a workspace you previously
 * opened").
 */

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
import { listRecents, type RecentWorkspaceRecord } from '../workspace/persistence.js';
import { withInstrumentation } from '../services/instrumentation/core.js';

interface Props {
  onOpen: (workspaceId: string) => void;
  onCreate: () => void;
  onDelete: (workspaceId: string) => void;
}

const KIND_LABEL: Record<RecentWorkspaceRecord['kind'], string> = {
  'browser-only': 'Browser',
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
  function WorkspaceSwitcher({ onOpen, onCreate: _onCreate, onDelete }: Props): React.ReactElement {
    const [rows, setRows] = useState<RecentWorkspaceRecord[]>([]);
    const metadataId = useId();
    // Row awaiting delete confirmation — replaces the native window.confirm
    // with the design-system's animated Dialog for visual consistency.
    const [pendingDelete, setPendingDelete] = useState<RecentWorkspaceRecord | null>(null);

    useEffect(() => {
      void listRecents().then(setRows);
    }, []);

    function confirmDelete(row: RecentWorkspaceRecord) {
      onDelete(row.id);
      setRows((rs) => rs.filter((r) => r.id !== row.id));
      setPendingDelete(null);
    }

    return (
      <div data-testid="workspace-switcher" className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Recent workspaces</p>
        {rows.length === 0 ? (
          <p data-testid="workspace-switcher-empty" className="text-sm text-muted-foreground">
            No recent workspaces — create one above to get started.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((row) => (
              <li
                key={row.id}
                className="studio-fade-in"
                data-testid="workspace-row"
                data-id={row.id}
                data-kind={row.kind}
              >
                <div className="group relative flex items-center gap-2 px-3 py-2 bg-muted rounded-md text-sm hover:bg-accent/50 transition-colors">
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
                    className="pointer-events-none min-w-0 truncate font-medium"
                  >
                    {row.name}
                  </span>
                  <span id={`${metadataId}-${row.id}`} className="pointer-events-none contents">
                    <span className="shrink-0 text-3xs px-1.5 py-0.5 rounded border border-border text-muted-foreground uppercase tracking-wide">
                      {KIND_LABEL[row.kind]}
                    </span>{' '}
                    <span className="shrink-0 ml-auto text-xs text-muted-foreground">
                      {formatRelativeTime(row.lastOpenedAt)}
                    </span>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="relative size-5 p-0 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 focus:opacity-100"
                    onClick={() => setPendingDelete(row)}
                    aria-label={`Delete ${row.name}`}
                  >
                    ×
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
                {pendingDelete ? `"${pendingDelete.name}" will be removed. This cannot be undone.` : ''}
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
      </div>
    );
  },
  { op: 'WorkspaceSwitcher' }
);
