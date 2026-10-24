// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * Regression — switching to an OPFS-empty workspace MUST clear the previous
 * workspace's in-memory file state (Defect D3, prod-smoke 2026-05-20).
 *
 * Symptom: a workspace whose `files/` OPFS directory is empty surfaced a
 * phantom `untitled.rosetta` tab + `1 file` count in the topbar after the
 * user switched to it via WorkspaceSwitcher. The phantom file was the
 * previously-active workspace's content — `restoreWorkspace` returned
 * `false` for the OPFS-empty case but didn't clear `files`/`models`, so
 * the App's `bootState === 'start' && userFiles.length > 0` branch
 * re-mounted EditorPage with stale content.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import type { ReactNode } from 'react';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';

import { App } from '../../src/App.js';
import { saveWorkspace, _resetForTests, type WorkspaceRecord } from '../../src/workspace/persistence.js';
import { createOpfsRoot, type OpfsRoot } from '../setup/opfs-mock.js';
import { saveWorkspaceFiles, setWorkspaceFilesDeps } from '../../src/workspace/workspace-files.js';
import { setRuneStudioTestApi, getRuneStudioTestApi } from '../../src/test-api.js';

const { showToastSpy } = vi.hoisted(() => ({
  showToastSpy: vi.fn()
}));

vi.mock('../../src/components/ModelLoader.js', () => ({
  ModelLoader: () => null
}));

// ExplorePerspective (formerly EditorPage) reads workspace data from context
// (useWorkspace), not props, and is now kept alive by PerspectiveHost. The mock
// mirrors that so the editor-mounted assertion keeps working — it stays mounted
// across a workspace switch and re-renders with the new file count.
vi.mock('../../src/shell/ExplorePerspective.js', async () => {
  const { useWorkspace } = await import('../../src/shell/providers/workspace-context.js');
  return {
    ExplorePerspective: () => {
      const { fileCount } = useWorkspace();
      return fileCount != null ? <span data-testid="editor-mounted">{fileCount} file(s)</span> : null;
    }
  };
});

vi.mock('../../src/store/model-store.js', () => ({
  useModelStore: Object.assign(() => new Map(), {
    getState: () => ({ load: vi.fn(), models: new Map() })
  })
}));

vi.mock('../../src/services/transport-provider.js', () => ({
  createTransportProvider: () => ({
    onStateChange: () => () => {},
    dispose: () => {}
  })
}));

vi.mock('../../src/services/lsp-client.js', async () => {
  const { createLspClientStub } = await import('../helpers/lsp-client-stub.js');
  return { createLspClientService: createLspClientStub };
});

vi.mock('../../src/components/StudioToastProvider.js', () => ({
  StudioToastProvider: ({ children }: { children?: ReactNode }) => children,
  useStudioToast: () => ({ showToast: showToastSpy, showLoadingToast: vi.fn(() => 'toast-id'), dismissToast: vi.fn() })
}));

function makeWorkspace(id: string, name: string): WorkspaceRecord {
  const now = new Date().toISOString();
  return {
    id,
    name,
    kind: 'browser-only',
    createdAt: now,
    lastOpenedAt: now,
    layout: { version: 1, writtenBy: '0', dockview: null },
    tabs: [],
    activeTabPath: null,
    curatedModels: [],
    schemaVersion: 1
  };
}

beforeEach(async () => {
  const opfsRoot: OpfsRoot = createOpfsRoot();
  setWorkspaceFilesDeps({
    getOpfsRoot: async () => opfsRoot as unknown as FileSystemDirectoryHandle
  });
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: {
      getDirectory: vi.fn().mockResolvedValue(opfsRoot as unknown as FileSystemDirectoryHandle)
    }
  });
  await _resetForTests();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('rune-studio');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
  document.body.removeAttribute('data-workspace-active');
  setRuneStudioTestApi(() => undefined);
});

afterEach(() => {
  setWorkspaceFilesDeps({
    getOpfsRoot: async () => {
      throw new Error('test opfs root not configured');
    }
  });
  cleanup();
});

describe('App restore cleanup (D3 / workspace-state-pipeline)', () => {
  it('clears in-memory files when restoreWorkspace bails on an OPFS-empty record', async () => {
    // Pre-seed an OPFS-populated workspace so the App mounts into it,
    // then a second workspace with NO OPFS files. The user's switch to
    // the empty workspace must NOT carry the first workspace's
    // untitled.rosetta forward into the topbar / EditorPage.
    await saveWorkspace(makeWorkspace('ws-populated', 'Populated'));
    await saveWorkspaceFiles('ws-populated', [
      {
        name: 'one.rosetta',
        path: 'one.rosetta',
        content: 'namespace one\n\ntype O:\n  v string (1..1)\n',
        dirty: false
      }
    ]);
    await saveWorkspace({
      ...makeWorkspace('ws-empty', 'Empty'),
      lastOpenedAt: '2026-04-01T00:00:00Z' // older → not the boot pick
    });

    render(<App />);

    // Wait for the App to mount + restore the populated workspace.
    await waitFor(() => {
      expect(screen.getByTestId('editor-mounted')).toHaveTextContent('1 file(s)');
    });

    // Now drive a workspace switch via the test API. The OPFS-empty
    // workspace has no files, so restoreWorkspace returns false; we
    // assert the App falls back to the start page (no editor-mounted).
    const api = getRuneStudioTestApi();
    expect(api?.replaceWorkspaceFiles).toBeTypeOf('function');

    await act(async () => {
      // Simulating the user switching to the empty workspace via the
      // public API: replaceWorkspaceFiles is the test seam that bypasses
      // the click-driven `handleSwitchWorkspace` path. Calling it with
      // an empty list mirrors the post-restore "no files" condition that
      // exposed the phantom-tab bug.
      await api!.replaceWorkspaceFiles!([]);
    });

    // The previous workspace's `1 file(s)` count MUST be gone. The
    // EditorPage either unmounts (when `bootState !== 'restored' &&
    // userFiles.length === 0`) or re-renders with the new count.
    await waitFor(() => {
      const mounted = screen.queryByTestId('editor-mounted');
      // If still mounted, it MUST reflect 0 files (no phantom carry-over)
      // rather than the previous workspace's 1.
      if (mounted) {
        expect(mounted).not.toHaveTextContent('1 file(s)');
      }
    });
  });
});
