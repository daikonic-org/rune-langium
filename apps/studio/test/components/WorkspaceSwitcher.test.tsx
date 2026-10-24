// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * T059 — WorkspaceSwitcher tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { WorkspaceSwitcher } from '../../src/components/WorkspaceSwitcher.js';
import { saveWorkspace, _resetForTests, type WorkspaceRecord } from '../../src/workspace/persistence.js';

function ws(id: string, name: string, kind: WorkspaceRecord['kind'], lastOpenedAt: string): WorkspaceRecord {
  const base = {
    id,
    name,
    createdAt: lastOpenedAt,
    lastOpenedAt,
    layout: { version: 1, writtenBy: '0', dockview: null },
    tabs: [],
    activeTabPath: null,
    curatedModels: [],
    schemaVersion: 1
  };
  if (kind === 'browser-only') return { ...base, kind };
  if (kind === 'folder-backed') return { ...base, kind, folderHandle: 'h-' + id };
  return {
    ...base,
    kind,
    gitBacking: {
      repoUrl: 'https://github.com/x/y',
      branch: 'main',
      user: 'x',
      tokenPath: `/${id}/.studio/token`,
      syncState: 'clean',
      lastSyncedSha: null
    }
  };
}

beforeEach(async () => {
  await _resetForTests();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('rune-studio');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
});

describe('WorkspaceSwitcher (T059)', () => {
  it('renders recent workspaces sorted by lastOpenedAt desc', async () => {
    await saveWorkspace(ws('a', 'Older', 'browser-only', '2026-04-01T00:00:00Z'));
    await saveWorkspace(ws('b', 'Newer', 'browser-only', '2026-04-25T00:00:00Z'));
    render(<WorkspaceSwitcher onOpen={() => {}} onCreate={() => {}} onDelete={() => {}} />);
    await waitFor(() => screen.getByText(/Newer/));
    const items = screen.getAllByTestId('workspace-row').map((el) => el.getAttribute('data-id'));
    expect(items).toEqual(['b', 'a']);
  });

  it('distinguishes the three workspace kinds visually', async () => {
    await saveWorkspace(ws('a', 'Project A', 'browser-only', '2026-04-25T00:00:00Z'));
    await saveWorkspace(ws('b', 'Project B', 'folder-backed', '2026-04-25T00:00:01Z'));
    await saveWorkspace(ws('c', 'Project C', 'git-backed', '2026-04-25T00:00:02Z'));
    render(<WorkspaceSwitcher onOpen={() => {}} onCreate={() => {}} onDelete={() => {}} />);
    await waitFor(() => screen.getByRole('button', { name: /Open Project A/ }));
    const rows = screen.getAllByTestId('workspace-row');
    const byKind = Object.fromEntries(rows.map((r) => [r.dataset['kind'], r.dataset['id']]));
    expect(byKind['browser-only']).toBe('a');
    expect(byKind['folder-backed']).toBe('b');
    expect(byKind['git-backed']).toBe('c');
  });

  it('clicking a row calls onOpen with the workspace id', async () => {
    await saveWorkspace(ws('w-1', 'One', 'browser-only', '2026-04-25T00:00:00Z'));
    const onOpen = vi.fn();
    render(<WorkspaceSwitcher onOpen={onOpen} onCreate={() => {}} onDelete={() => {}} />);
    await waitFor(() => screen.getByRole('button', { name: /Open One/ }));
    fireEvent.click(screen.getByRole('button', { name: /Open One/ }));
    expect(onOpen).toHaveBeenCalledWith('w-1');
  });

  it('describes storage and recency separately from the workspace action name', async () => {
    await saveWorkspace(ws('w-1', 'One', 'browser-only', new Date().toISOString()));
    render(<WorkspaceSwitcher onOpen={() => {}} onCreate={() => {}} onDelete={() => {}} />);
    const open = await screen.findByRole('button', { name: 'Open One', exact: true });
    expect(open).toHaveAccessibleDescription('Browser Not connected just now');
    expect(screen.getByText('Browser')).toBeVisible();
    expect(screen.getByText('just now')).toBeVisible();
  });

  it('Delete button on a row calls onDelete after confirmation', async () => {
    await saveWorkspace(ws('w-1', 'Doomed', 'browser-only', '2026-04-25T00:00:00Z'));
    const onDelete = vi.fn();
    render(<WorkspaceSwitcher onOpen={() => {}} onCreate={() => {}} onDelete={onDelete} />);
    await waitFor(() => screen.getByText(/Doomed/));
    fireEvent.click(screen.getByRole('button', { name: /delete doomed/i }));
    // Confirmation now goes through the design-system dialog, not window.confirm.
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByTestId('workspace-delete-confirm'));
    expect(onDelete).toHaveBeenCalledWith('w-1');
  });
});
it('distinguishes repository sync from local storage without inventing a Saved status', async () => {
  await saveWorkspace(ws('git', 'Not yet pushed', 'git-backed', '2026-10-24T00:00:00Z'));
  render(<WorkspaceSwitcher onOpen={() => {}} onCreate={() => {}} onDelete={() => {}} />);
  expect(await screen.findByText('Sync not recorded')).toBeVisible();
  expect(screen.queryByText('Saved', { exact: true })).toBeNull();
});
it('keeps a failed recent-list read distinct from an empty list and retries on Refresh', async () => {
  const storage = await import('../../src/workspace/persistence.js');
  await saveWorkspace(ws('retry', 'Recovered workspace', 'browser-only', '2026-10-24T00:00:00Z'));
  const read = vi.spyOn(storage, 'listRecents').mockRejectedValueOnce(new Error('Storage unavailable'));
  try {
    render(<WorkspaceSwitcher onOpen={() => {}} onCreate={() => {}} onDelete={() => {}} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be read');
    expect(screen.queryByTestId('workspace-switcher-empty')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh recent workspaces' }));
    expect(await screen.findByRole('button', { name: 'Open Recovered workspace', exact: true })).toBeVisible();
  } finally {
    read.mockRestore();
  }
});
