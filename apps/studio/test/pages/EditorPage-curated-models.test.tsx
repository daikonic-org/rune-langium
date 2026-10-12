// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * Regression guard: "Curated Models" modal wiring inside EditorPage.
 *
 * History: originally the trigger was the ActivityBar Database icon. Task 3
 * (feat/sidebar-perspectives) detached that button from the rail; the modal
 * state (`showCuratedModels`) remains in EditorPage and will be re-homed into
 * the WorkspacesPerspective panel in Task 6. The click-to-open tests are
 * skipped until the new trigger is wired up.
 *
 * OOM regression note (fixed): this file used to crash the vitest worker
 * fork with a V8 "JavaScript heap out of memory" error on the first
 * `renderEditorPage(...)` call. Root cause: the `useStudioToast` mock below
 * returned a FRESH `showToast: vi.fn()` object on every call, violating the
 * real hook's identity contract (the real provider returns a
 * useMemo/useCallback-stable context value). `CodegenProvider`'s
 * `handlePreviewWorkerFailure` useCallback depends on `showToast`, and its
 * worker-init useEffect depends on that callback and calls
 * `setCodegenWorker(new Worker(...))` — so every render produced a new
 * callback, re-ran the init effect, set new worker state, and re-rendered,
 * forever. Passive-effect loops never trip React's "Maximum update depth
 * exceeded" guard, so the loop allocated Workers until heap exhaustion.
 * The fix hoists the toast spies so `useStudioToast` returns stable
 * function identities (see the mock below); any hook mock consumed by
 * effect dependency arrays must preserve referential stability.
 */

import React, { useImperativeHandle } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, fireEvent } from '@testing-library/react';
import { setRuneStudioTestApi } from '../../src/test-api.js';
import { closeDialogViaEscape } from '../helpers/base-ui-overlay.js';
import { usePerspectiveStore } from '../../src/store/perspective-store.js';

const { editorStoreState, useEditorStore } = vi.hoisted(() => {
  const editorStoreState = {
    nodes: [] as Array<{ id: string; data: { namespace?: string; name?: string; $type?: string } }>,
    get nodesById() {
      return new Map(this.nodes.map((n) => [n.id, n]));
    },
    getVisibleNodes() {
      return this.nodes;
    },
    edges: [] as Array<{ source: string; target: string }>,
    selectedNodeId: undefined as string | undefined,
    detailPanelOpen: false,
    visibility: { expandedNamespaces: new Set<string>(), hiddenNodeIds: new Set<string>() },
    focusMode: true,
    layoutOptions: { direction: 'LR' as const, nodeSeparation: 50, rankSeparation: 100, engine: 'dagre' as const },
    selectNode: vi.fn(),
    toggleNamespace: vi.fn(),
    expandAllNamespaces: vi.fn(),
    collapseAllNamespaces: vi.fn(),
    setLayoutEngine: vi.fn(),
    loadModels: vi.fn(),
    loadDeferredExports: vi.fn(),
    pendingHydrationNamespaces: [] as string[],
    hydratedNamespaces: [] as string[],
    requestNamespaceHydration: vi.fn(),
    markNamespacesHydrated: vi.fn(),
    resetHydration: vi.fn()
  };
  const useEditorStore = ((selector: (s: typeof editorStoreState) => unknown) =>
    selector(editorStoreState)) as typeof import('@rune-langium/visual-editor').useEditorStore;
  // `subscribe` is required by HydrationOrchestrator (Task 1, wired into both
  // CodegenProvider — Task 3 — and ExplorePerspective — Task 5), which calls
  // `useEditorStore.subscribe(listener)` in a mount effect. Provide a minimal
  // working implementation so that mount effect doesn't throw under this
  // hand-rolled mock (this file's tests don't exercise hydration, so the
  // listener set only needs to be a safe no-op sink).
  const stateListeners = new Set<(state: typeof editorStoreState) => void>();
  Object.assign(useEditorStore, {
    getState: () => editorStoreState,
    setState: vi.fn(),
    subscribe: (listener: (state: typeof editorStoreState) => void) => {
      stateListeners.add(listener);
      return () => {
        stateListeners.delete(listener);
      };
    }
  });
  return { editorStoreState, useEditorStore };
});

class MockWorker {
  static instances: MockWorker[] = [];
  readonly postMessage = vi.fn();
  readonly addEventListener = vi.fn();
  readonly removeEventListener = vi.fn();
  readonly terminate = vi.fn();
  constructor(_url: URL, _options?: WorkerOptions) {
    MockWorker.instances.push(this);
  }
}

vi.mock('@rune-langium/visual-editor', async () => ({
  RuneTypeGraph: React.forwardRef((_props: unknown, ref: React.ForwardedRef<unknown>) => {
    useImperativeHandle(ref, () => ({
      fitView: () => {},
      focusNode: () => {},
      relayout: () => {},
      exportRosetta: () => new Map()
    }));
    return React.createElement('div');
  }),
  NamespaceExplorerPanel: () => React.createElement('div'),
  StructureView: () => React.createElement('div'),
  EditorFormPanel: () => React.createElement('div'),
  ExpressionBuilder: () => React.createElement('div'),
  NameCell: () => null,
  CardinalityCell: () => null,
  TypePickerCell: () => null,
  BUILTIN_TYPES: [],
  AST_TYPE_TO_NODE_TYPE: {},
  resolveNodeKind: () => 'data',
  buildTypeOptions: (await vi.importActual<typeof import('@rune-langium/visual-editor')>('@rune-langium/visual-editor'))
    .buildTypeOptions,
  useEditorStore,
  createEditorCommitRegistry: (
    await vi.importActual<typeof import('@rune-langium/visual-editor')>('@rune-langium/visual-editor')
  ).createEditorCommitRegistry,
  useModelSourceSync: () => ({ flush: async () => {} }),
  // Mirrors the real hook: a ref synced to the latest value via
  // useLayoutEffect, not a render-body write.
  useLatestRef: <T,>(value: T) => {
    const ref = React.useRef(value);
    React.useLayoutEffect(() => {
      ref.current = value;
    }, [value]);
    return ref;
  },
  selectNodeRepository: (nodesById: Map<string, unknown>) => ({
    byId: (id: string) => nodesById?.get(id),
    byType: () => [],
    byNamespace: () => [],
    namespaces: () => [],
    all: () => [...(nodesById?.values() ?? [])]
  })
}));

vi.mock('../../src/components/SourceEditor.js', () => ({
  SourceEditor: React.forwardRef((_props: unknown, ref: React.ForwardedRef<unknown>) => {
    useImperativeHandle(ref, () => ({ revealLine: () => {}, revealPosition: () => {} }));
    return React.createElement('div');
  })
}));

vi.mock('../../src/components/ConnectionStatus.js', () => ({
  ConnectionStatus: () => React.createElement('div')
}));

vi.mock('../../src/components/DiagnosticsPanel.js', () => ({
  DiagnosticsPanel: () => React.createElement('div')
}));

vi.mock('../../src/components/ExportDialog.js', () => ({
  ExportDialog: () => null
}));

vi.mock('../../src/components/CodePreviewPanel.js', () => ({
  CodePreviewPanel: () => React.createElement('div')
}));

vi.mock('../../src/components/FormPreviewPanel.js', () => ({
  FormPreviewPanel: () => React.createElement('div')
}));

vi.mock('../../src/components/GraphFilterMenu.js', () => ({
  GraphFilterMenu: () => React.createElement('div')
}));

vi.mock('../../src/shell/DockShell.js', () => ({
  DockShell: () => React.createElement('div', { 'data-testid': 'dock-shell' })
}));

vi.mock('../../src/hooks/useLspDiagnosticsBridge.js', () => ({
  useLspDiagnosticsBridge: () => undefined
}));

vi.mock('../../src/services/workspace.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/workspace.js')>();
  return {
    ...actual,
    linkDocument: vi.fn().mockResolvedValue({ linked: false, errors: [], newModels: [] })
  };
});

vi.mock('../../src/components/StudioToastProvider.js', () => {
  // IMPORTANT: these spies must be hoisted OUTSIDE the useStudioToast mock body.
  // The real useStudioToast returns useCallback-stable functions; CodegenProvider
  // depends on `showToast` identity (useCallback → worker-init useEffect →
  // setCodegenWorker). Returning a fresh vi.fn() per call re-ran that effect on
  // every render, creating a new Worker + state update each time — an infinite
  // passive-effect loop that OOM'd the vitest worker fork.
  const showToast = vi.fn();
  const showLoadingToast = vi.fn(() => 'toast-id');
  const dismissToast = vi.fn();
  return {
    StudioToastProvider: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(React.Fragment, {}, children),
    useStudioToast: () => ({ showToast, showLoadingToast, dismissToast })
  };
});

import { renderEditorPage } from './editor-page-harness.js';

describe('EditorPage — Curated Models button wiring', () => {
  beforeEach(() => {
    vi.stubGlobal('Worker', MockWorker);
    MockWorker.instances = [];
    setRuneStudioTestApi(() => undefined);
    editorStoreState.nodes = [];
    editorStoreState.selectedNodeId = undefined;
    vi.clearAllMocks();
    // EditorPage embeds PerspectiveHost; store defaults to 'workspaces' which
    // renders WorkspacesPerspective (requires context). These tests render a
    // loaded workspace — reset to 'explore' so DockShell is shown.
    usePerspectiveStore.setState({ activePerspective: 'explore' });
  });

  afterEach(() => {
    setRuneStudioTestApi(() => undefined);
    vi.unstubAllGlobals();
    cleanup();
  });

  it('does not render the curated models dialog on mount', () => {
    renderEditorPage({
      models: [],
      files: [{ name: 'trade.rosetta', path: 'trade.rosetta', content: 'namespace alpha', dirty: false }]
    });
    expect(screen.queryByTestId('curated-models-dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('model-loader')).not.toBeInTheDocument();
  });

  it('mounts the Explore workbench for deferred-only curated bundles', () => {
    renderEditorPage({
      models: [],
      files: [],
      deferredExports: [
        {
          filePath: 'cdm/cdm.base.math',
          namespace: 'cdm.base.math',
          exports: [{ type: 'Data', name: 'Quantity' }]
        }
      ]
    });

    expect(screen.getByTestId('dock-shell')).toBeInTheDocument();
  });

  // TODO(T6/WorkspacesPerspective): restore when the curated-models trigger is
  // re-homed into the WorkspacesPerspective panel. The ActivityBar Database
  // button was removed in Task 3; `showCuratedModels` state stays in EditorPage.
  it.skip('opens a dialog containing ModelLoader when the ActivityBar Curated Models button is clicked', () => {
    renderEditorPage({
      models: [],
      files: [{ name: 'trade.rosetta', path: 'trade.rosetta', content: 'namespace alpha', dirty: false }]
    });

    fireEvent.click(screen.getByRole('button', { name: /curated models/i }));

    // Dialog renders via radix portal — getBy* searches the whole document.
    const dialog = screen.getByTestId('curated-models-dialog');
    expect(dialog).toBeInTheDocument();

    // The body mounts the real <ModelLoader />.
    expect(screen.getByTestId('model-loader')).toBeInTheDocument();
    // Dialog title is "Reference Models" AND ModelLoader's own section
    // heading is also "Reference Models" — both should be present, so
    // assert that at least one matches (avoids brittle getByText with two
    // identical strings).
    expect(screen.getAllByText(/reference models/i).length).toBeGreaterThanOrEqual(1);
    // At least one curated bundle button from the registry (cdm/fpml/rune-dsl)
    // is rendered, proving ModelLoader is fully alive in the dialog body.
    expect(screen.getByRole('button', { name: /cdm \(common domain model\)/i })).toBeInTheDocument();
  });

  // TODO(T6/WorkspacesPerspective): restore alongside the open test above.
  it.skip('closes the curated models dialog when the user presses Esc', async () => {
    renderEditorPage({
      models: [],
      files: [{ name: 'trade.rosetta', path: 'trade.rosetta', content: 'namespace alpha', dirty: false }]
    });

    fireEvent.click(screen.getByRole('button', { name: /curated models/i }));
    expect(screen.getByTestId('curated-models-dialog')).toBeInTheDocument();

    // Shared helper — wraps `userEvent.keyboard('{Escape}')` + `waitFor` to
    // ride out Radix's async Presence unmount. See
    // `test/helpers/base-ui-overlay.ts` waits for the portal to unmount.
    await closeDialogViaEscape('curated-models-dialog');
  });
});
