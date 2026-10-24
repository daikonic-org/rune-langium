// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * Regression — workspace-switch race that cross-contaminated curated
 * bindings (Codex P1, PR #220 / fix/studio-workspace-state-pipeline).
 *
 * Original bug: the App-level persist effect (added in this same PR) ran
 * whenever `restoredWorkspace` OR the global `loadedModels` map changed.
 * During a switch from workspace A (curated: [cdm]) → workspace B (curated:
 * [fpml]), the sequence was:
 *
 *   1. `setRestoredWorkspace(B)` — but `loadedModels` still holds [cdm]
 *      (A's bundles; the model-store is global and isn't reset on switch).
 *   2. Persist effect fires immediately with derived = [cdm], prev (B's
 *      saved) = [fpml]. Not equal → write [cdm] to B's IDB record.
 *   3. B's fpml load eventually settles; effect fires again with
 *      derived = [cdm, fpml]; writes that mixed state.
 *
 * Net result: B's record permanently inherits A's bundles. On the next
 * mount B replays A's bundles, hiding its own. The fix gates the persist
 * effect on a `curatedSyncedWorkspaceId === restoredWorkspace.id` signal
 * that only flips after `restoreWorkspace` has awaited the workspace's
 * own declared loads (Promise.allSettled). Until the signal matches, the
 * effect is a no-op so stale A-state can't reach B's record.
 *
 * This test drives the race by mocking the model-store with a small
 * controller that lets the test simulate workspace A's `cdm` "leaking
 * into" the global map during B's restore. We assert B's IDB record is
 * never written with `[cdm]`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import type { ReactNode } from 'react';
import { render, waitFor, cleanup } from '@testing-library/react';

import { App } from '../../src/App.js';
import { saveWorkspace, loadWorkspace, _resetForTests, type WorkspaceRecord } from '../../src/workspace/persistence.js';
import { createOpfsRoot, type OpfsRoot } from '../setup/opfs-mock.js';
import { saveWorkspaceFiles, setWorkspaceFilesDeps } from '../../src/workspace/workspace-files.js';

const { showToastSpy, loadSpy, unloadSpy, modelsRef } = vi.hoisted(() => ({
  showToastSpy: vi.fn(),
  loadSpy: vi.fn(),
  unloadSpy: vi.fn(),
  modelsRef: { current: new Map<string, unknown>() }
}));

vi.mock('../../src/components/ModelLoader.js', () => ({
  ModelLoader: () => null
}));

vi.mock('../../src/shell/ExplorePerspective.js', async () => {
  const { useWorkspace } = await import('../../src/shell/providers/workspace-context.js');
  return {
    ExplorePerspective: () => {
      const { fileCount } = useWorkspace();
      return fileCount > 0 ? <span data-testid="explore-workbench">{fileCount} file(s)</span> : null;
    }
  };
});

/**
 * Minimal zustand-flavoured mock that re-evaluates selectors when the
 * test calls `notifyModelStoreSubscribers()`. We can't import zustand
 * here (the App imports `useModelStore` as a hook), so we implement the
 * call shape directly: `useStore(selector)` returns the current selected
 * slice, and `useStore.getState()` returns the full state object.
 */
vi.mock('../../src/store/model-store.js', () => {
  type State = {
    models: Map<string, unknown>;
    load: typeof loadSpy;
    unload: typeof unloadSpy;
  };
  const getState = (): State => ({
    models: modelsRef.current,
    load: loadSpy,
    // `unload(id)` is called by restoreWorkspace to evict bundles that
    // aren't declared by the new workspace. Mirroring the prod behaviour
    // — drop the entry from modelsRef so the next selector read reflects
    // the eviction.
    unload: (id: string) => {
      unloadSpy(id);
      const next = new Map(modelsRef.current);
      next.delete(id);
      modelsRef.current = next;
    }
  });
  const useStore = ((selector: (s: State) => unknown) => selector(getState())) as unknown as {
    (selector: unknown): unknown;
    getState: () => State;
  };
  useStore.getState = getState;
  return { useModelStore: useStore };
});

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

function makeWorkspace(
  id: string,
  name: string,
  curatedModels: WorkspaceRecord['curatedModels'] = []
): WorkspaceRecord {
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
    curatedModels,
    schemaVersion: 1
  };
}

function makeLoadedModel(id: string, archiveUrl: string) {
  return {
    source: {
      id,
      name: id.toUpperCase(),
      repoUrl: `https://example/${id}.git`,
      ref: 'master',
      paths: ['**/*.rosetta'],
      archiveUrl
    },
    commitHash: 'latest',
    files: [],
    loadedAt: Date.now()
  };
}

beforeEach(async () => {
  loadSpy.mockReset();
  unloadSpy.mockReset();
  modelsRef.current = new Map();
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
});

afterEach(() => {
  setWorkspaceFilesDeps({
    getOpfsRoot: async () => {
      throw new Error('test opfs root not configured');
    }
  });
  cleanup();
});

describe('App curated-bindings persist gate — switch-race (Codex P1 / PR #220)', () => {
  /**
   * Direct regression for the race Codex flagged: A's bundles live in the
   * global model-store. We switch to B (which declares fpml). The persist
   * effect must NOT write B's IDB record with A's cdm — neither while B's
   * own loads are in-flight (gate stays closed) nor after they settle
   * (eviction has dropped cdm from the store first).
   *
   * Strategy:
   *  - Seed IDB with A (most recent) so it auto-restores on cold start.
   *  - Pre-populate the model-store with [cdm] to simulate A's loaded
   *    bundles. (loadSpy is a no-op, so the cold-start replay of A's
   *    declared cdm-binding doesn't actually mutate the store — we
   *    pre-seed instead.)
   *  - Wait for A's cold-start restore to settle.
   *  - Drive the actual switch path via the test API
   *    (`switchWorkspace('ws-B')`) — same code path the
   *    WorkspaceSwitcher fires for real user clicks.
   *  - Re-read B's record. It must NOT contain cdm. The pre-fix code
   *    would have written [cdm] because:
   *      (a) `setRestoredWorkspace(B)` flipped the effect's dep before
   *      (b) B's curated loads could populate the store with fpml.
   *    The persist-gate + eviction together close that window.
   */
  it('switch A→B does NOT write A-only bundle into B record', async () => {
    const olderTime = new Date(Date.now() - 60_000).toISOString();
    const newerTime = new Date().toISOString();
    await saveWorkspace({
      ...makeWorkspace('ws-A', 'Workspace A', [
        { modelId: 'cdm', loadedVersion: 'latest', loadedAt: newerTime, updateAvailable: false }
      ]),
      lastOpenedAt: newerTime
    });
    await saveWorkspaceFiles('ws-A', [
      { name: 'a.rosetta', path: 'a.rosetta', content: 'namespace a\n\ntype A:\n  v string (1..1)\n', dirty: false }
    ]);
    await saveWorkspace({
      ...makeWorkspace('ws-B', 'Workspace B', [
        { modelId: 'fpml', loadedVersion: 'latest', loadedAt: olderTime, updateAvailable: false }
      ]),
      lastOpenedAt: olderTime
    });
    await saveWorkspaceFiles('ws-B', [
      { name: 'b.rosetta', path: 'b.rosetta', content: 'namespace b\n\ntype B:\n  v string (1..1)\n', dirty: false }
    ]);

    // Pre-populate the model-store with cdm to simulate A's bundles
    // surviving in the global store after A's cold-start restore.
    modelsRef.current = new Map<string, unknown>([['cdm', makeLoadedModel('cdm', 'https://example/cdm.tar.gz')]]);

    render(<App />);

    // Wait for the cold-start restore of A to flip switchWorkspace into
    // the test API. We can't rely on `data-workspace-active` because the
    // test workspace's minimal .rosetta content may not survive parse —
    // but `setRuneStudioTestApi` is set in an effect that fires after
    // `setRestoredWorkspace`, so the API's presence implies A is the
    // active workspace.
    await waitFor(() => {
      expect(window.__runeStudioTestApi?.switchWorkspace).toBeDefined();
    });
    // Also pump until A's lastOpenedAt bumps — confirming A's
    // restoreWorkspace ran through the IDB write step.
    await waitFor(async () => {
      const a = await loadWorkspace('ws-A');
      expect(a?.lastOpenedAt).not.toBe(newerTime);
    });

    // Now drive the actual switch (same path WorkspaceSwitcher / start-
    // page Recents list invokes).
    await window.__runeStudioTestApi!.switchWorkspace!('ws-B');

    // Pump pending microtasks so any persist-effect write completes.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const bAfter = await loadWorkspace('ws-B');
    const bModelIds = bAfter?.curatedModels?.map((b) => b.modelId) ?? [];

    // The cross-contamination guard: B's record must NOT contain cdm.
    expect(bModelIds).not.toContain('cdm');
    // And the eviction step must have removed cdm from the store, so
    // unloadSpy was called for it.
    expect(unloadSpy).toHaveBeenCalledWith('cdm');
  });

  /**
   * Inverse safety check — when B is the active workspace AND B's declared
   * cdm binding IS reflected in the model-store (a normal restore with all
   * loads settled), the persist effect MUST be allowed to write B's record.
   * This pins the gate as "no-op while pending, then opens" rather than
   * "no-op forever".
   */
  it('persist effect writes when curated sync settles for the active workspace', async () => {
    await saveWorkspace(makeWorkspace('ws-settled', 'Settled', []));
    await saveWorkspaceFiles('ws-settled', [
      { name: 's.rosetta', path: 's.rosetta', content: 'namespace s\n\ntype S:\n  v string (1..1)\n', dirty: false }
    ]);
    const view = render(<App />);
    await waitFor(() => expect(document.body).toHaveAttribute('data-workspace-active', 'true'));
    modelsRef.current = new Map<string, unknown>([['cdm', makeLoadedModel('cdm', 'https://example/cdm.tar.gz')]]);
    view.rerender(<App />);
    await waitFor(async () => {
      const ws = await loadWorkspace('ws-settled');
      expect(ws?.curatedModels?.map((b) => b.modelId)).toContain('cdm');
    });
  });
});
