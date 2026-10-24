// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * T029 — `<WorkspaceSwitcher>` is mounted on the start page above the
 * curated-models row (FR-011 / 014-US2).
 *
 * The fresh-profile path already covers the empty-recents branch in
 * App-restore.test.tsx; this test pins the multi-recents render so a
 * regression that removes the switcher from the start page fails fast.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

import { App } from '../../src/App.js';
import { saveWorkspace, _resetForTests, type WorkspaceRecord } from '../../src/workspace/persistence.js';

function makeWorkspace(id: string, name: string, lastOpenedAt: string): WorkspaceRecord {
  return {
    id,
    name,
    kind: 'browser-only',
    createdAt: lastOpenedAt,
    lastOpenedAt,
    layout: { version: 1, writtenBy: '0', dockview: null },
    tabs: [],
    activeTabPath: null,
    curatedModels: [],
    schemaVersion: 1
  };
}

beforeEach(async () => {
  await _resetForTests();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('rune-studio');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
  document.body.removeAttribute('data-workspace-active');
});

afterEach(() => {
  cleanup();
});

describe('WorkspaceSwitcher mounted on start page (T029/US2)', () => {
  it('renders all recent workspaces by name when listRecents() returns 2', async () => {
    // Two recents persisted; the most-recent triggers a restore. Force the
    // restore to fail so App lands on the start page where the switcher
    // sits above the curated-models row.
    await saveWorkspace(makeWorkspace('ws-alpha', 'Alpha', '2026-04-24T00:00:00Z'));
    await saveWorkspace(makeWorkspace('ws-beta', 'Beta', '2026-04-25T00:00:00Z'));
    const persistence = await import('../../src/workspace/persistence.js');
    const spy = vi.spyOn(persistence, 'loadWorkspace').mockResolvedValue(undefined);

    render(<App />);

    // Start-page mount of the switcher (ABOVE the curated-models row).
    await waitFor(() => {
      expect(screen.getByTestId('workspace-switcher')).toBeInTheDocument();
    });

    // Both workspace names are surfaced — most-recent first. The switcher
    // populates rows asynchronously via its own listRecents() effect, so
    // wait for the first row to land before snapshotting the order.
    await waitFor(() => {
      expect(screen.getAllByTestId('workspace-row')).toHaveLength(2);
    });
    const rows = screen.getAllByTestId('workspace-row');
    expect(rows[0]).toHaveAttribute('data-id', 'ws-beta');
    expect(rows[1]).toHaveAttribute('data-id', 'ws-alpha');
    expect(screen.getByRole('button', { name: /Open Alpha/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open Beta/i })).toBeInTheDocument();

    spy.mockRestore();
  });

  it('renders the "No recent workspaces" placeholder on a fresh profile', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('workspace-switcher')).toBeInTheDocument();
    });
    expect(await screen.findByTestId('workspace-switcher-empty')).toHaveTextContent(/no recent workspaces/i);
  });
});
