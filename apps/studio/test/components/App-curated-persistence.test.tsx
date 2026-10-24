// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * Regression — curated bundle bindings round-trip through IndexedDB
 * (Defect D1, prod-smoke 2026-05-20).
 *
 * Reported symptom: loading CDM + FpML on the start page, opening a
 * workspace, then refreshing dropped the explorer from 4768 types
 * (CDM + FpML + base) back to 22 (base only). The IDB workspace record
 * persisted with `curatedModels: []`, so on the next mount nothing
 * triggered the re-load.
 *
 * Root cause: `useModelStore.load()` populated the in-memory store but
 * never wrote the bindings back to `WorkspaceRecord.curatedModels`.
 * Fix: an App-level effect that watches `loadedModels` and persists the
 * derived bindings, plus a replay step in `restoreWorkspace` that calls
 * `useModelStore.load()` for each persisted binding.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import type { ReactNode } from 'react';
import { render, waitFor, cleanup } from '@testing-library/react';

import { App } from '../../src/App.js';
import { saveWorkspace, loadWorkspace, _resetForTests, type WorkspaceRecord } from '../../src/workspace/persistence.js';
import { createOpfsRoot, type OpfsRoot } from '../setup/opfs-mock.js';
import { saveWorkspaceFiles, setWorkspaceFilesDeps } from '../../src/workspace/workspace-files.js';

const { showToastSpy, loadSpy, modelsRef } = vi.hoisted(() => ({
  showToastSpy: vi.fn(),
  loadSpy: vi.fn(),
  modelsRef: { current: new Map() }
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

vi.mock('../../src/store/model-store.js', () => {
  const useStore = ((selector: (s: { models: Map<string, unknown> }) => unknown) => {
    return selector({ models: modelsRef.current });
  }) as unknown as { (selector: unknown): unknown; getState: () => unknown };
  useStore.getState = () => ({
    load: loadSpy,
    models: modelsRef.current,
    unload: (id: string) => {
      modelsRef.current = new Map(modelsRef.current);
      modelsRef.current.delete(id);
    }
  });
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

beforeEach(async () => {
  loadSpy.mockReset();
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

describe('App curated-bundle persistence (D1 / workspace-state-pipeline)', () => {
  it('retains failed selections through a retry but removes a successfully loaded model on unload', async () => {
    const loadedAt = new Date().toISOString();
    const bindings = ['cdm', 'fpml'].map((modelId) => ({
      modelId,
      loadedVersion: 'saved-version',
      loadedAt,
      updateAvailable: false
    }));
    await saveWorkspace(makeWorkspace('ws-curated-retry', 'Curated retry', bindings));
    await saveWorkspaceFiles('ws-curated-retry', []);
    loadSpy.mockResolvedValue(undefined);
    const view = render(<App />);
    await waitFor(() => expect(document.body).toHaveAttribute('data-workspace-active', 'true'));
    expect((await loadWorkspace('ws-curated-retry'))?.curatedModels).toEqual(bindings);

    modelsRef.current = new Map([
      [
        'cdm',
        {
          source: { id: 'cdm', archiveUrl: 'https://example/cdm/latest.tar.gz' },
          commitHash: 'retry-version',
          files: [],
          loadedAt: Date.now()
        }
      ]
    ]);
    view.rerender(<App />);
    await waitFor(async () => {
      const saved = (await loadWorkspace('ws-curated-retry'))?.curatedModels;
      expect(saved).toHaveLength(2);
      expect(saved?.[0]).toMatchObject({ modelId: 'cdm', loadedVersion: 'retry-version' });
      expect(saved?.[1]).toEqual(bindings[1]);
    });

    modelsRef.current = new Map();
    view.rerender(<App />);
    await waitFor(async () => {
      expect((await loadWorkspace('ws-curated-retry'))?.curatedModels).toEqual([bindings[1]]);
    });
  });
  it.each(['cdm', 'temporarily-missing'])(
    'retains an unavailable declared binding (%s) after curated-only restore',
    async (modelId) => {
      const binding = {
        modelId,
        loadedVersion: 'saved-version',
        loadedAt: new Date().toISOString(),
        updateAvailable: false
      };
      await saveWorkspace(makeWorkspace('ws-curated-outage', 'Curated outage', [binding]));
      await saveWorkspaceFiles('ws-curated-outage', []);
      loadSpy.mockResolvedValue(undefined);
      const view = render(<App />);
      await waitFor(() => expect(document.body).toHaveAttribute('data-workspace-active', 'true'));
      view.rerender(<App />);
      expect((await loadWorkspace('ws-curated-outage'))?.curatedModels).toEqual([binding]);
      cleanup();
      render(<App />);
      await waitFor(() => expect(document.body).toHaveAttribute('data-workspace-active', 'true'));
      expect((await loadWorkspace('ws-curated-outage'))?.curatedModels).toEqual([binding]);
      if (modelId === 'cdm') expect(loadSpy).toHaveBeenCalledTimes(2);
    }
  );
  it('restores curated bindings even when a workspace has no source files', async () => {
    await saveWorkspace(
      makeWorkspace('ws-curated-only', 'Curated only', [
        {
          modelId: 'cdm',
          loadedVersion: 'latest',
          loadedAt: new Date().toISOString(),
          updateAvailable: false
        }
      ])
    );
    await saveWorkspaceFiles('ws-curated-only', []);
    render(<App />);
    await waitFor(() => expect(loadSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'cdm' })));
    await waitFor(() => expect(document.body).toHaveAttribute('data-workspace-active', 'true'));
  });
  it('replays persisted curated bindings on workspace restore', async () => {
    await saveWorkspace(
      makeWorkspace('ws-restore-curated', 'Restored Curated', [
        {
          modelId: 'cdm',
          loadedVersion: 'latest',
          loadedAt: new Date().toISOString(),
          updateAvailable: false
        }
      ])
    );
    await saveWorkspaceFiles('ws-restore-curated', [
      {
        name: 'trade.rosetta',
        path: 'trade.rosetta',
        content: 'namespace ex\n\ntype T:\n  v string (1..1)\n',
        dirty: false
      }
    ]);

    render(<App />);

    await waitFor(() => {
      expect(document.body).toHaveAttribute('data-workspace-active', 'true');
    });

    // The model-store load was kicked once per persisted binding with the
    // registry source (resolved by `getModelSource(modelId)`).
    await waitFor(() => {
      expect(loadSpy).toHaveBeenCalled();
    });
    const sources = loadSpy.mock.calls.map((c) => (c[0] as { id: string }).id);
    expect(sources).toContain('cdm');
  });

  it('persists curated bindings to the workspace record when a bundle is loaded', async () => {
    await saveWorkspace(makeWorkspace('ws-persist-curated', 'Persist Curated'));
    await saveWorkspaceFiles('ws-persist-curated', [
      {
        name: 'trade.rosetta',
        path: 'trade.rosetta',
        content: 'namespace ex\n\ntype T:\n  v string (1..1)\n',
        dirty: false
      }
    ]);

    const view = render(<App />);
    await waitFor(() => expect(document.body).toHaveAttribute('data-workspace-active', 'true'));

    modelsRef.current = new Map([
      [
        'cdm',
        {
          source: {
            id: 'cdm',
            name: 'CDM',
            repoUrl: 'https://example/cdm.git',
            ref: 'master',
            paths: ['**/*.rosetta'],
            archiveUrl: 'https://example/cdm/latest.tar.gz'
          },
          commitHash: 'latest',
          files: [],
          loadedAt: Date.now()
        }
      ]
    ]);

    view.rerender(<App />);

    await waitFor(async () => {
      const ws = await loadWorkspace('ws-persist-curated');
      expect(ws?.curatedModels?.map((b) => b.modelId)).toContain('cdm');
    });
  });
});
