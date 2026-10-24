// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * Regression — launcher file-load must not overwrite the active workspace
 * (Codex P1, PR #238).
 *
 * Before the side-bar perspectives change, `FileLoader` was only reachable on
 * the no-workspace start page, so `App.handleFilesLoaded` could safely reuse
 * `restoredWorkspace`. With perspectives, the Workspaces launcher is reachable
 * while a project is open (the rail exposes it with `hasWorkspace=true`), so
 * reusing the open workspace meant "New workspace" / "Select Files"
 * silently overwrote — or wiped — the active project's files.
 *
 * Fix: `handleFilesLoaded(files, targetWorkspaceId?)`.
 *   - no target (launcher load)  → ALWAYS create a new workspace; never touch
 *                                  the open one.
 *   - explicit target (git path) → load INTO that exact workspace, no duplicate.
 *
 * The launcher surface renders inside EditorPage (mocked here), so the flow is
 * driven through the `loadFiles` test-API seam — the same approach the
 * curated switch-race regression uses for `switchWorkspace`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import type { ReactNode } from 'react';
import { render, waitFor, act, cleanup } from '@testing-library/react';

import { App } from '../../src/App.js';
import { saveWorkspace, listRecents, _resetForTests, type WorkspaceRecord } from '../../src/workspace/persistence.js';
import { createOpfsRoot, type OpfsRoot } from '../setup/opfs-mock.js';
import { saveWorkspaceFiles, loadWorkspaceFiles, setWorkspaceFilesDeps } from '../../src/workspace/workspace-files.js';

vi.mock('../../src/components/ModelLoader.js', () => ({ ModelLoader: () => null }));
vi.mock('../../src/shell/ExplorePerspective.js', async () => {
  const { useWorkspace } = await import('../../src/shell/providers/workspace-context.js');
  return {
    ExplorePerspective: () => {
      const { fileCount } = useWorkspace();
      return fileCount > 0 ? <span data-testid="explore-workbench">{fileCount} file(s)</span> : null;
    }
  };
});
vi.mock('../../src/store/model-store.js', () => ({ useModelStore: () => new Map() }));
vi.mock('../../src/services/transport-provider.js', () => ({
  createTransportProvider: () => ({ onStateChange: () => () => {}, dispose: () => {} })
}));
vi.mock('../../src/services/lsp-client.js', async () => {
  const { createLspClientStub } = await import('../helpers/lsp-client-stub.js');
  return { createLspClientService: createLspClientStub };
});
vi.mock('../../src/components/StudioToastProvider.js', () => ({
  StudioToastProvider: ({ children }: { children?: ReactNode }) => children,
  useStudioToast: () => ({ showToast: vi.fn(), showLoadingToast: vi.fn(() => 'toast-id'), dismissToast: vi.fn() })
}));

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

function file(name: string, content: string) {
  return { name, path: name, content, dirty: false };
}

const A_CONTENT = 'namespace project.a\n\ntype Trade:\n  tradeDate date (1..1)\n';

beforeEach(async () => {
  const opfsRoot: OpfsRoot = createOpfsRoot();
  setWorkspaceFilesDeps({ getOpfsRoot: async () => opfsRoot as unknown as FileSystemDirectoryHandle });
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: { getDirectory: vi.fn().mockResolvedValue(opfsRoot as unknown as FileSystemDirectoryHandle) }
  });
  await _resetForTests();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('rune-studio');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
  document.body.removeAttribute('data-workspace-active');
});

afterEach(() => {
  setWorkspaceFilesDeps({
    getOpfsRoot: async () => {
      throw new Error('test opfs root not configured');
    }
  });
  delete window.__runeStudioTestApi;
  cleanup();
});

async function mountWithRestoredWorkspaceA(): Promise<void> {
  await saveWorkspace(makeWorkspace('ws-A', 'Project A', '2026-05-22T10:00:00Z'));
  await saveWorkspaceFiles('ws-A', [file('trade.rosetta', A_CONTENT)]);
  render(<App />);
  await waitFor(() => expect(document.body).toHaveAttribute('data-workspace-active', 'true'), { timeout: 4000 });
  await waitFor(() => expect(window.__runeStudioTestApi?.loadFiles).toBeDefined());
}

describe('launcher file-load does not overwrite the active workspace (Codex P1 / #238)', () => {
  it('creates a NEW workspace on a no-target load instead of overwriting the open one', async () => {
    await mountWithRestoredWorkspaceA();

    const newFiles = [file('foo.rosetta', 'namespace new.load\n\ntype Foo:\n  bar string (1..1)\n')];
    await act(async () => {
      await window.__runeStudioTestApi!.loadFiles!(newFiles);
    });

    // The active workspace's files are untouched.
    const aFiles = await loadWorkspaceFiles('ws-A');
    expect(aFiles).toHaveLength(1);
    expect(aFiles[0].content).toBe(A_CONTENT);

    // A brand-new workspace holds the loaded files.
    const recents = await listRecents();
    expect(recents).toHaveLength(2);
    const created = recents.find((r) => r.id !== 'ws-A');
    expect(created).toBeDefined();
    const createdFiles = await loadWorkspaceFiles(created!.id);
    expect(createdFiles).toHaveLength(1);
    expect(createdFiles[0].content).toContain('namespace new.load');
  });

  it('wipes nothing when "New workspace" (empty load) fires with a project open', async () => {
    await mountWithRestoredWorkspaceA();

    await act(async () => {
      await window.__runeStudioTestApi!.loadFiles!([]);
    });

    // The open project keeps its file — the empty load created a separate
    // blank workspace rather than clearing the active one.
    const aFiles = await loadWorkspaceFiles('ws-A');
    expect(aFiles).toHaveLength(1);
    expect(aFiles[0].content).toBe(A_CONTENT);
    expect(await listRecents()).toHaveLength(2);
  });

  it('loads INTO the explicitly targeted workspace (git-clone path), not the open one, and creates no duplicate', async () => {
    // A is most-recent → restored on mount. B is an older, separate workspace.
    await saveWorkspace(makeWorkspace('ws-A', 'Project A', '2026-05-22T10:00:00Z'));
    await saveWorkspaceFiles('ws-A', [file('trade.rosetta', A_CONTENT)]);
    await saveWorkspace(makeWorkspace('ws-B', 'Project B', '2026-05-22T09:00:00Z'));
    await saveWorkspaceFiles('ws-B', []);

    render(<App />);
    await waitFor(() => expect(document.body).toHaveAttribute('data-workspace-active', 'true'), { timeout: 4000 });
    await waitFor(() => expect(window.__runeStudioTestApi?.loadFiles).toBeDefined());

    const cloned = [file('cloned.rosetta', 'namespace git.cloned\n\ntype Bar:\n  baz string (1..1)\n')];
    await act(async () => {
      await window.__runeStudioTestApi!.loadFiles!(cloned, 'ws-B');
    });

    // Files land in the targeted workspace B…
    const bFiles = await loadWorkspaceFiles('ws-B');
    expect(bFiles).toHaveLength(1);
    expect(bFiles[0].content).toContain('namespace git.cloned');
    // …the open workspace A is untouched…
    const aFiles = await loadWorkspaceFiles('ws-A');
    expect(aFiles[0].content).toBe(A_CONTENT);
    // …and no duplicate workspace was minted.
    expect(await listRecents()).toHaveLength(2);
  });
});
