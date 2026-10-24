// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useState } from 'react';

// Captures the mount-time onStateChange listener so tests can simulate the
// transport re-emitting 'connected' (what happens for real when reconnect()
// succeeds) without a second component mount.
let transportStateCb: ((state: { mode: string; status: string }) => void) | null = null;
// Lets a test suppress the transport's normal "immediately connected on
// subscribe" behavior, so it can simulate a mount where the transport never
// reaches 'connected' during the initial connect attempt (e.g. connect()
// rejects) and only later reports 'connected' via a reconnect().
let fireConnectedOnSubscribe = true;

const connect = vi.fn().mockResolvedValue(undefined);
const reconnect = vi.fn().mockImplementation(async () => {
  // Mirrors production: a successful reconnect() also causes the underlying
  // transport to transition back to 'connected', re-firing the still-subscribed
  // mount-time onStateChange listener.
  transportStateCb?.({ mode: 'direct', status: 'connected' });
});
const suspendProjectResolution = vi.fn();
const syncWorkspaceFiles = vi.fn();
const syncWorkspaceModels = vi.fn().mockResolvedValue(undefined);
const dispose = vi.fn();
vi.mock('../../../src/services/lsp-client.js', () => ({
  createLspClientService: () => ({
    connect,
    reconnect,
    syncWorkspaceFiles,
    syncWorkspaceModels,
    suspendProjectResolution,
    dispose
  })
}));
vi.mock('../../../src/services/transport-provider.js', () => ({
  createTransportProvider: () => ({
    // Simulate a transport that immediately reports itself connected, like the real
    // provider does once its underlying connection opens.
    onStateChange: (cb: (state: { mode: string; status: string }) => void) => {
      transportStateCb = cb;
      if (fireConnectedOnSubscribe) {
        cb({ mode: 'direct', status: 'connected' });
      }
      return () => {};
    },
    dispose: () => {}
  })
}));
// Ensure the connect path runs (config.lspEnabled must be truthy).
vi.mock('../../../src/config.js', () => ({ config: { lspEnabled: true }, studioConfig: {} }));

import { LspProvider } from '../../../src/shell/providers/LspProvider.js';
import { useLsp } from '../../../src/shell/providers/lsp-context.js';
import { WorkspaceStateContext, type WorkspaceState } from '../../../src/shell/providers/workspace-context.js';
import { useOutputStore } from '../../../src/store/output-store.js';
import { useActivityStore } from '../../../src/store/activity-store.js';
import { useExploreFileNavStore } from '../../../src/shell/explore-file-nav-store.js';

function wsState(files: WorkspaceState['files']): WorkspaceState {
  return {
    workspaceId: 'w',
    workspaceKind: 'browser-only',
    workspaceName: 'w',
    fileCount: files.length,
    files,
    models: [],
    parsedModels: [],
    deferredExports: [],
    parseErrors: new Map()
  };
}
function LspProbe() {
  const { lspClient } = useLsp();
  return <span data-testid="c">{lspClient ? 'client' : 'none'}</span>;
}

beforeEach(() => {
  connect.mockClear();
  reconnect.mockClear();
  syncWorkspaceFiles.mockClear();
  fireConnectedOnSubscribe = true;
  useExploreFileNavStore.setState({ activeEditorFile: undefined, syncStatus: null });
});

describe('LspProvider', () => {
  it('creates one client, connects once, exposes it, and re-syncs docs on file change (no reconnect)', () => {
    function Host() {
      const [files, setFiles] = useState<WorkspaceState['files']>([]);
      return (
        <WorkspaceStateContext.Provider value={wsState(files)}>
          <button
            onClick={() => setFiles([{ name: 'a.rosetta', path: 'a.rosetta', content: 'namespace a', dirty: false }])}
          >
            add
          </button>
          <LspProvider>
            <LspProbe />
          </LspProvider>
        </WorkspaceStateContext.Provider>
      );
    }
    render(<Host />);
    expect(connect).toHaveBeenCalledTimes(1);
    act(() => screen.getByText('add').click());
    expect(syncWorkspaceFiles).toHaveBeenCalled(); // doc-set re-sync on file change
    expect(reconnect).not.toHaveBeenCalled(); // switch is NOT a reconnect
  });

  it('syncs only the active editor document to the LSP client, not the whole workspace', () => {
    useExploreFileNavStore.setState({ activeEditorFile: 'a.rosetta', syncStatus: null });
    const files: WorkspaceState['files'] = [
      { name: 'a.rosetta', path: 'a.rosetta', content: 'namespace a', dirty: false },
      { name: 'b.rosetta', path: 'b.rosetta', content: 'namespace b', dirty: false }
    ];
    render(
      <WorkspaceStateContext.Provider value={wsState(files)}>
        <LspProvider>
          <LspProbe />
        </LspProvider>
      </WorkspaceStateContext.Provider>
    );

    expect(syncWorkspaceFiles).toHaveBeenCalled();
    const lastCall = syncWorkspaceFiles.mock.calls.at(-1)![0];
    expect(lastCall).toEqual([{ name: 'a.rosetta', path: 'a.rosetta', content: 'namespace a', dirty: false }]);
  });

  it('re-syncs to the newly active document when the active editor file changes', () => {
    const files: WorkspaceState['files'] = [
      { name: 'a.rosetta', path: 'a.rosetta', content: 'namespace a', dirty: false },
      { name: 'b.rosetta', path: 'b.rosetta', content: 'namespace b', dirty: false }
    ];
    function Host() {
      return (
        <WorkspaceStateContext.Provider value={wsState(files)}>
          <LspProvider>
            <LspProbe />
          </LspProvider>
        </WorkspaceStateContext.Provider>
      );
    }
    useExploreFileNavStore.setState({ activeEditorFile: 'a.rosetta', syncStatus: null });
    render(<Host />);
    act(() => useExploreFileNavStore.getState().setActiveEditorFile('b.rosetta'));

    const lastCall = syncWorkspaceFiles.mock.calls.at(-1)![0];
    expect(lastCall).toEqual([{ name: 'b.rosetta', path: 'b.rosetta', content: 'namespace b', dirty: false }]);
  });

  it('connect success publishes an activity entry with op-log opId and durationMs', async () => {
    useActivityStore.setState({ entries: [] });
    function Host() {
      return (
        <WorkspaceStateContext.Provider value={wsState([])}>
          <LspProvider>
            <LspProbe />
          </LspProvider>
        </WorkspaceStateContext.Provider>
      );
    }
    await act(async () => {
      render(<Host />);
    });

    const lspEntries = useActivityStore.getState().entries.filter((e) => e.tag === 'lsp');
    expect(lspEntries.length).toBeGreaterThan(0);
    const connectedEntry = lspEntries.find((e) => e.msg === 'connected');
    expect(connectedEntry?.opId).toBeDefined();
    expect(connectedEntry?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('reconnect() does not re-fire the mount-time connect logging as a duplicate "connected" entry', async () => {
    useActivityStore.setState({ entries: [] });
    function ReconnectProbe() {
      const { reconnect } = useLsp();
      return (
        <button type="button" onClick={() => reconnect()}>
          reconnect
        </button>
      );
    }
    function Host() {
      return (
        <WorkspaceStateContext.Provider value={wsState([])}>
          <LspProvider>
            <ReconnectProbe />
          </LspProvider>
        </WorkspaceStateContext.Provider>
      );
    }
    await act(async () => {
      render(<Host />);
    });

    const connectedAfterMount = useActivityStore
      .getState()
      .entries.filter((e) => e.tag === 'lsp' && e.msg === 'connected');
    expect(connectedAfterMount).toHaveLength(1);

    await act(async () => {
      screen.getByText('reconnect').click();
    });

    // The transport re-emits 'connected' as a side effect of reconnect() (see the
    // mock above) — the mount-time listener must NOT log a second 'connected'
    // entry for it; only the reconnect callback's own 'reconnected' entry should
    // appear.
    const connectedAfterReconnect = useActivityStore
      .getState()
      .entries.filter((e) => e.tag === 'lsp' && e.msg === 'connected');
    expect(connectedAfterReconnect).toHaveLength(1);

    const reconnectedEntries = useActivityStore
      .getState()
      .entries.filter((e) => e.tag === 'lsp' && e.msg === 'reconnected');
    expect(reconnectedEntries).toHaveLength(1);
  });

  it('reconnect() after a failed initial connect does not double-log a connected entry', async () => {
    useActivityStore.setState({ entries: [] });
    // Simulate a mount where the transport never reaches 'connected' during
    // the initial connect attempt, and connect() itself rejects — mirrors a
    // real initial-connect failure (e.g. LSP server unreachable at mount).
    fireConnectedOnSubscribe = false;
    connect.mockRejectedValueOnce(new Error('initial connect failed'));

    function ReconnectProbe() {
      const { reconnect } = useLsp();
      return (
        <button type="button" onClick={() => reconnect()}>
          reconnect
        </button>
      );
    }
    function Host() {
      return (
        <WorkspaceStateContext.Provider value={wsState([])}>
          <LspProvider>
            <ReconnectProbe />
          </LspProvider>
        </WorkspaceStateContext.Provider>
      );
    }
    await act(async () => {
      render(<Host />);
    });

    // The initial connect attempt failed — prove the test is actually
    // exercising the failure path, not accidentally succeeding.
    const failedEntries = useActivityStore
      .getState()
      .entries.filter((e) => e.tag === 'lsp' && e.msg.startsWith('connect failed'));
    expect(failedEntries).toHaveLength(1);

    await act(async () => {
      screen.getByText('reconnect').click();
    });

    // reconnect() re-fires the still-subscribed mount-time onStateChange
    // listener with 'connected' (see the reconnect mock above). Without
    // closing the initial-connect span on failure, the mount-time listener
    // would still treat this as the "first" connected transition and log a
    // stale 'connected' entry alongside reconnect()'s own 'reconnected'
    // entry — two entries for one user action. Assert there is exactly one.
    const connectedEntries = useActivityStore
      .getState()
      .entries.filter((e) => e.tag === 'lsp' && (e.msg === 'connected' || e.msg === 'reconnected'));
    expect(connectedEntries).toHaveLength(1);
    expect(connectedEntries[0]?.msg).toBe('reconnected');
  });

  it('records a failed reconnect once in each history under the same operation id', async () => {
    reconnect.mockRejectedValueOnce(new Error('Reconnect socket closed'));
    function Probe() {
      const { reconnect: retry } = useLsp();
      return <button onClick={retry}>Retry failed connection</button>;
    }
    await act(async () =>
      render(
        <WorkspaceStateContext.Provider value={wsState([])}>
          <LspProvider>
            <Probe />
          </LspProvider>
        </WorkspaceStateContext.Provider>
      )
    );
    useActivityStore.getState().clearEntries();
    useOutputStore.getState().clearLines();
    await act(async () => screen.getByText('Retry failed connection').click());
    const activity = useActivityStore
      .getState()
      .entries.filter((entry) => entry.msg.includes('Reconnect socket closed'));
    const output = useOutputStore.getState().lines.filter((entry) => entry.text.includes('Reconnect socket closed'));
    expect(activity).toHaveLength(1);
    expect(output).toHaveLength(1);
    expect(activity[0].opId).toBeDefined();
    expect(output[0].opId).toBe(activity[0].opId);
  });

  it('reconnect() with LSP disabled does not falsely log a "reconnected" success entry', async () => {
    useActivityStore.setState({ entries: [] });
    const { config } = await import('../../../src/config.js');
    config.lspEnabled = false;
    try {
      function ReconnectProbe() {
        const { reconnect } = useLsp();
        return (
          <button type="button" onClick={() => reconnect()}>
            reconnect
          </button>
        );
      }
      function Host() {
        return (
          <WorkspaceStateContext.Provider value={wsState([])}>
            <LspProvider>
              <ReconnectProbe />
            </LspProvider>
          </WorkspaceStateContext.Provider>
        );
      }
      await act(async () => {
        render(<Host />);
      });

      await act(async () => {
        screen.getByText('reconnect').click();
      });

      expect(reconnect).not.toHaveBeenCalled();

      const reconnectedEntries = useActivityStore
        .getState()
        .entries.filter((e) => e.tag === 'lsp' && e.msg === 'reconnected');
      expect(reconnectedEntries).toHaveLength(0);

      const unavailableEntries = useActivityStore
        .getState()
        .entries.filter((e) => e.tag === 'lsp' && e.msg.includes('unavailable'));
      expect(unavailableEntries.length).toBeGreaterThan(0);
    } finally {
      config.lspEnabled = true;
    }
  });

  it('throws when useLsp is used outside the provider', () => {
    function Bare() {
      useLsp();
      return null;
    }
    expect(() => render(<Bare />)).toThrow(/within an LspProvider/);
  });
});

it('suspends semantic operations while a managed capture is loading instead of syncing the legacy graph', async () => {
  const { ProjectContext } = await import('../../../src/shell/providers/project-context.js');
  syncWorkspaceModels.mockClear();
  suspendProjectResolution.mockClear();
  render(
    <WorkspaceStateContext.Provider value={wsState([])}>
      <ProjectContext.Provider
        value={{ status: 'ready', diagnostics: [], runtime: { managed: true, status: 'loading', diagnostics: [] } }}
      >
        <LspProvider>
          <LspProbe />
        </LspProvider>
      </ProjectContext.Provider>
    </WorkspaceStateContext.Provider>
  );
  expect(suspendProjectResolution).toHaveBeenCalled();
  expect(syncWorkspaceModels).not.toHaveBeenCalled();
});
