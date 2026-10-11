// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { SourceNavigationFeedbackContext } from '../../src/shell/source-navigation-feedback-context.js';
import React, { useEffect, useImperativeHandle } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, waitFor, screen, act, fireEvent } from '@testing-library/react';
import { usePreviewStore } from '../../src/store/preview-store.js';
import { usePerspectiveStore } from '../../src/store/perspective-store.js';
import { useExploreFileNavStore } from '../../src/shell/explore-file-nav-store.js';
import { setRuneStudioTestApi } from '../../src/test-api.js';

const {
  editorStoreState,
  useEditorStore,
  diagnosticsState,
  useDiagnosticsStore,
  runeTypeGraphMockState,
  resizeObserverMockState,
  centerStackMockState,
  namespaceExplorerMockState,
  structureViewMockState,
  showToastSpy
} = vi.hoisted(() => {
  const editorStoreState = {
    nodes: [] as Array<{
      id: string;
      data: { namespace?: string; name?: string; $type?: string; deferred?: boolean };
      meta: { namespace: string; errors: unknown[]; hasExternalRefs: boolean; deferred?: boolean };
    }>,
    get nodesById() {
      return new Map(this.nodes.map((n) => [n.id, n]));
    },
    getVisibleNodes() {
      return this.nodes;
    },
    revealNeighbors: vi.fn(),
    edges: [] as Array<{ source: string; target: string }>,
    selectedNodeId: undefined as string | undefined,
    detailPanelOpen: false,
    visibility: { expandedNamespaces: new Set<string>(), hiddenNodeIds: new Set<string>() },
    focusMode: true,
    layoutOptions: { direction: 'LR', nodeSeparation: 50, rankSeparation: 100, engine: 'dagre' as const },
    selectNode: vi.fn((nodeId: string, _options?: { isolateInFocusMode?: boolean; reapplyFocusMode?: boolean }) => {
      // Routes through the mocked setState (defined below) rather than
      // mutating editorStoreState directly, so `useEditorStore.subscribe`
      // listeners fire here exactly like the real Zustand store's `set()`
      // does — ExplorePerspective's navigation-history subscription (the
      // single choke point tracking node visits across Explorer/Graph/
      // Structure selection) depends on this.
      useEditorStore.setState({ selectedNodeId: nodeId, detailPanelOpen: nodeId !== null });
    }),
    toggleNamespace: vi.fn(),
    expandAllNamespaces: vi.fn(),
    collapseAllNamespaces: vi.fn(),
    setLayoutEngine: vi.fn(),
    loadModels: vi.fn(),
    loadDeferredExports: vi.fn(),
    pendingHydrationNamespaces: [] as string[],
    hydratedNamespaces: [] as string[],
    hydrationNonce: 0,
    requestNamespaceHydration: vi.fn(),
    markNamespacesHydrated: vi.fn(),
    resetHydration: vi.fn(),
    updateExpression: vi.fn()
  };

  const useEditorStore = ((selector: (state: typeof editorStoreState) => unknown) =>
    selector(editorStoreState)) as typeof import('@rune-langium/visual-editor').useEditorStore;
  // `subscribe` is required by HydrationOrchestrator (Task 1, wired into both
  // CodegenProvider — Task 3 — and ExplorePerspective — Task 5), which calls
  // `useEditorStore.subscribe(listener)` in a mount effect. The real Zustand
  // store's `subscribe` notifies listeners on every `setState`; mirror that
  // here (a bare selector function has no `.subscribe` of its own) so those
  // mount effects don't throw under this hand-rolled mock.
  const stateListeners = new Set<(state: typeof editorStoreState) => void>();
  Object.assign(useEditorStore, {
    getState: () => editorStoreState,
    setState: vi.fn((partial: Partial<typeof editorStoreState>) => {
      Object.assign(editorStoreState, partial);
      for (const listener of stateListeners) listener(editorStoreState);
    }),
    subscribe: (listener: (state: typeof editorStoreState) => void) => {
      stateListeners.add(listener);
      return () => {
        stateListeners.delete(listener);
      };
    }
  });

  const diagnosticsState = { fileDiagnostics: new Map(), totalErrors: 0, totalWarnings: 0 };
  const useDiagnosticsStore = (() =>
    diagnosticsState) as typeof import('../../src/store/diagnostics-store.js').useDiagnosticsStore;
  Object.assign(useDiagnosticsStore, {
    getState: () => diagnosticsState
  });

  const runeTypeGraphMockState = {
    focusNode: vi.fn(),
    fitView: vi.fn(),
    relayout: vi.fn(),
    latestConfig: undefined as
      | {
          layout?: { direction?: 'LR' | 'TB'; groupByInheritance?: boolean };
        }
      | undefined,
    latestCallbacks: undefined as
      | {
          onNavigateToType?: (nodeId: string) => void;
        }
      | undefined
  };

  const resizeObserverMockState = {
    instances: [] as Array<{
      callback: ResizeObserverCallback;
      targets: Element[];
      disconnected: boolean;
    }>
  };
  const centerStackMockState = {
    showGraph: true,
    setShowGraph: undefined as ((value: boolean) => void) | undefined
  };

  const namespaceExplorerMockState = {
    latestProps: undefined as
      | {
          onSelectNode?: (nodeId: string) => void;
          [key: string]: unknown;
        }
      | undefined
  };

  // Sentinel functions used as identity-stable cell component references in the
  // StructureView mock. Assigned as plain functions so vi.fn() is not needed —
  // we only care about identity, not call counts.
  const SENTINEL_NAME_CELL = function SentinelNameCell() {
    return null;
  };
  const SENTINEL_TYPE_CELL = function SentinelTypePickerCell() {
    return null;
  };
  const SENTINEL_CARD_CELL = function SentinelCardinalityCell() {
    return null;
  };

  const structureViewMockState = {
    latestProps: undefined as
      | {
          navigationRevision?: number;
          focusedTypeId?: string;
          adapterDoc?: unknown;
          cellComponents?: {
            name?: unknown;
            type?: unknown;
            card?: unknown;
          };
        }
      | undefined,
    SENTINEL_NAME_CELL,
    SENTINEL_TYPE_CELL,
    SENTINEL_CARD_CELL
  };

  const showToastSpy = vi.fn();

  return {
    editorStoreState,
    useEditorStore,
    diagnosticsState,
    useDiagnosticsStore,
    runeTypeGraphMockState,
    resizeObserverMockState,
    centerStackMockState,
    namespaceExplorerMockState,
    structureViewMockState,
    showToastSpy
  };
});

function stubResizeObserver(): void {
  vi.stubGlobal(
    'ResizeObserver',
    class MockResizeObserver {
      private instance: { callback: ResizeObserverCallback; targets: Element[]; disconnected: boolean };
      constructor(callback: ResizeObserverCallback) {
        this.instance = { callback, targets: [], disconnected: false };
        resizeObserverMockState.instances.push(this.instance);
      }
      observe(target: Element) {
        this.instance.targets.push(target);
      }
      disconnect() {
        this.instance.disconnected = true;
      }
      unobserve() {}
    }
  );
}

const { sourceEditorMockState, dockShellMockState, diagnosticsPanelMockState, inspectorMockState } = vi.hoisted(() => ({
  sourceEditorMockState: {
    revealLine: vi.fn(() => true),
    clearRevealHighlight: vi.fn(),
    showSource: true,
    latestProps: undefined as
      | {
          activeFile?: string;
          onNavigateToNode?: (nodeId: string) => void;
          onEditorViewCreated?: (filePath: string, view: { id: string }) => void;
        }
      | undefined
  },
  dockShellMockState: {
    latestProps: undefined as
      | {
          focusPanel?: { component: string; nonce: number } | null;
        }
      | undefined
  },
  inspectorMockState: {
    actions: undefined as import('@rune-langium/visual-editor').EditorFormActions | undefined
  },
  diagnosticsPanelMockState: {
    latestProps: undefined as
      | {
          fileDiagnostics?: Map<string, Array<{ message: string; severity?: 1 | 2 | 3 | 4; source?: string }>>;
        }
      | undefined
  }
}));

class MockWorker {
  static instances: MockWorker[] = [];
  readonly postMessage = vi.fn();
  readonly listeners = new Map<string, Set<EventListener>>();
  readonly addEventListener = vi.fn((type: string, listener: EventListener) => {
    const handlers = this.listeners.get(type) ?? new Set<EventListener>();
    handlers.add(listener);
    this.listeners.set(type, handlers);
  });
  readonly removeEventListener = vi.fn((type: string, listener: EventListener) => {
    this.listeners.get(type)?.delete(listener);
  });
  readonly terminate = vi.fn();

  constructor(_url: URL, _options?: WorkerOptions) {
    MockWorker.instances.push(this);
  }

  dispatch(type: 'message' | 'error' | 'messageerror', event: unknown) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event as Event);
    }
  }
}

vi.mock('@rune-langium/visual-editor', async () => ({
  RuneTypeGraph: React.forwardRef(
    (
      {
        callbacks,
        config
      }: {
        callbacks?: { onNavigateToType?: (nodeId: string) => void };
        config?: { layout?: { direction?: 'LR' | 'TB'; groupByInheritance?: boolean } };
      },
      ref: React.ForwardedRef<{
        fitView(): void;
        focusNode(nodeId: string): void;
        relayout(config?: { groupByInheritance?: boolean }): void;
        exportRosetta(): Map<string, string>;
      }>
    ) => {
      runeTypeGraphMockState.latestConfig = config;
      runeTypeGraphMockState.latestCallbacks = callbacks;
      useImperativeHandle(ref, () => ({
        fitView: runeTypeGraphMockState.fitView,
        focusNode: runeTypeGraphMockState.focusNode,
        relayout: runeTypeGraphMockState.relayout,
        exportRosetta: () => new Map()
      }));
      return React.createElement('div');
    }
  ),
  NamespaceExplorerPanel: (props: { onSelectNode?: (nodeId: string) => void; [key: string]: unknown }) => {
    namespaceExplorerMockState.latestProps = props;
    return React.createElement('div');
  },
  StructureView: (props: {
    focusedTypeId?: string;
    adapterDoc?: unknown;
    cellComponents?: { name?: unknown; type?: unknown; card?: unknown };
  }) => {
    structureViewMockState.latestProps = props;
    return React.createElement('div', { 'data-testid': 'structure-view-mock' });
  },
  EditorFormPanel: (props: { actions: import('@rune-langium/visual-editor').EditorFormActions }) => {
    inspectorMockState.actions = props.actions;
    return React.createElement('div');
  },
  ExpressionBuilder: () => React.createElement('div'),
  // Cell components: exported as the sentinel functions so EditorPage's
  // structureCellComponents memo captures the exact same references.
  NameCell: structureViewMockState.SENTINEL_NAME_CELL,
  CardinalityCell: structureViewMockState.SENTINEL_CARD_CELL,
  TypePickerCell: structureViewMockState.SENTINEL_TYPE_CELL,
  BUILTIN_TYPES: [],
  AST_TYPE_TO_NODE_TYPE: (
    await vi.importActual<typeof import('@rune-langium/visual-editor')>('@rune-langium/visual-editor')
  ).AST_TYPE_TO_NODE_TYPE,
  buildTypeOptions: (await vi.importActual<typeof import('@rune-langium/visual-editor')>('@rune-langium/visual-editor'))
    .buildTypeOptions,
  // Mirrors the production helper's fallback chain
  // (data.$type → data.typeKind → node.type → 'data'). Kept as a tiny
  // hand-rolled stub instead of re-importing the real helper so the mock
  // module stays a self-contained set of explicit exports — adding new
  // production exports here is intentional friction.
  resolveNodeKind: (nodeOrData: unknown) => {
    if (nodeOrData == null) return 'data';
    const obj = nodeOrData as { data?: unknown; type?: string };
    const d = (obj.data ?? obj) as { $type?: string; typeKind?: string } | undefined;
    return d?.$type ?? d?.typeKind ?? obj?.type ?? 'data';
  },
  // Phase A — tiny stubs mirroring the real display helpers' output shape so
  // graphNodesToAdapterDocument's projectStructureMeta can run under the mock.
  annotationsToDisplay: (annotations: unknown[] | undefined) =>
    (annotations ?? []).map((ref) => {
      const r = ref as { annotation?: { $refText?: string }; attribute?: { $refText?: string } };
      return { name: r.annotation?.$refText ?? 'unknown', attribute: r.attribute?.$refText };
    }),
  conditionsToDisplay: (conditions: unknown[] | undefined) =>
    (conditions ?? []).map((c) => {
      const cond = c as { name?: string };
      return { name: cond.name ?? undefined, expressionText: '' };
    }),
  useEditorStore,
  useModelSourceSync: () => {},
  // Mirrors the real hook: a ref synced to the latest value via
  // useLayoutEffect, not a render-body write.
  useLatestRef: <T,>(value: T) => {
    const ref = React.useRef(value);
    React.useLayoutEffect(() => {
      ref.current = value;
    }, [value]);
    return ref;
  },
  // Node-id utilities — exact mirrors of node-projection.ts.
  // so ExplorePerspective can call them inside the mock module boundary.
  isTypeNodeId: (nodeId: string) => !nodeId.endsWith('#RosettaFunction'),
  qualifiedNameFromNodeId: (nodeId: string) => nodeId.split('#', 1)[0]!,
  nameFromNodeId: (nodeId: string) => {
    const qualifiedName = nodeId.split('#', 1)[0]!;
    const idx = qualifiedName.lastIndexOf('.');
    return idx < 0 ? qualifiedName : qualifiedName.slice(idx + 1);
  },
  splitNodeId: (nodeId: string) => {
    const qualifiedName = nodeId.split('#', 1)[0]!;
    const idx = qualifiedName.lastIndexOf('.');
    if (idx < 0) return { namespace: '', name: qualifiedName };
    return { namespace: qualifiedName.slice(0, idx), name: qualifiedName.slice(idx + 1) };
  },
  makeNodeId: (namespace: string, name: string, kind?: string) => {
    const qualifiedName = namespace ? `${namespace}.${name}` : name;
    return kind ? `${qualifiedName}#${kind}` : qualifiedName;
  },
  // Minimal stub — tests exercise ExplorePerspective's render path, not the
  // repository implementation. byId delegates to the Map directly.
  selectNodeRepository: (nodesById: Map<string, unknown>) => ({
    byId: (id: string) => nodesById?.get(id),
    byType: () => [],
    byNamespace: () => [],
    namespaces: () => [],
    all: () => [...(nodesById?.values() ?? [])]
  })
}));

vi.mock('../../src/components/SourceEditor.js', () => ({
  SourceEditor: React.forwardRef(
    (
      props: {
        activeFile?: string;
        onNavigateToNode?: (nodeId: string) => void;
        onEditorViewCreated?: (filePath: string, view: { id: string }) => void;
      },
      ref
    ) => {
      sourceEditorMockState.latestProps = props;
      useImperativeHandle(ref, () => ({
        revealLine: sourceEditorMockState.revealLine,
        clearRevealHighlight: sourceEditorMockState.clearRevealHighlight,
        revealPosition: vi.fn()
      }));

      useEffect(() => {
        if (props.activeFile) {
          props.onEditorViewCreated?.(props.activeFile, { id: props.activeFile });
        }
      }, [props.activeFile, props.onEditorViewCreated]);

      return React.createElement('div', {
        'data-testid': 'source-editor-mock',
        'data-active-file': props.activeFile ?? ''
      });
    }
  )
}));

vi.mock('../../src/components/ConnectionStatus.js', () => ({
  ConnectionStatus: () => React.createElement('div')
}));

vi.mock('../../src/components/DiagnosticsPanel.js', () => ({
  DiagnosticsPanel: (props: {
    fileDiagnostics: Map<string, Array<{ message: string; severity?: 1 | 2 | 3 | 4; source?: string }>>;
  }) => {
    diagnosticsPanelMockState.latestProps = props;
    return React.createElement('div');
  }
}));

vi.mock('../../src/components/ExportDialog.js', () => ({
  ExportDialog: () => null
}));

vi.mock('@rune-langium/design-system/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    React.createElement('button', props, children)
}));

vi.mock('@rune-langium/design-system/ui/separator', () => ({
  Separator: () => React.createElement('div')
}));

vi.mock('@rune-langium/design-system/ui/scroll-area', () => ({
  ScrollArea: ({ children }: { children?: React.ReactNode }) => React.createElement('div', {}, children)
}));

vi.mock('../../src/services/workspace.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/workspace.js')>();
  return {
    ...actual,
    linkDocument: vi.fn().mockResolvedValue({ linked: false, errors: [], newModels: [] })
  };
});

vi.mock('../../src/components/StudioToastProvider.js', () => ({
  StudioToastProvider: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, {}, children),
  useStudioToast: () => ({ showToast: showToastSpy, showLoadingToast: vi.fn(() => 'toast-id'), dismissToast: vi.fn() })
}));

vi.mock('lucide-react', () => ({
  Maximize2: () => React.createElement('span'),
  LayoutGrid: () => React.createElement('span'),
  Code2: () => React.createElement('span'),
  Network: () => React.createElement('span'),
  FileCode2: () => React.createElement('span'),
  Info: () => React.createElement('span'),
  XCircle: () => React.createElement('span'),
  Check: () => React.createElement('span'),
  Download: () => React.createElement('span'),
  Share2: () => React.createElement('span'),
  Wand2: () => React.createElement('span'),
  Search: () => React.createElement('span'),
  ChevronDown: () => React.createElement('span'),
  ChevronUp: () => React.createElement('span'),
  MoreHorizontal: () => React.createElement('span'),
  Layers: () => React.createElement('span'),
  Database: () => React.createElement('span'),
  Bell: () => React.createElement('span'),
  Settings: () => React.createElement('span'),
  // Workspace dropdown (e2e-batch): EditorPage adds Plus + LogOut icons
  // for the Popover menu items (new workspace / close workspace).
  Plus: () => React.createElement('span'),
  LogOut: () => React.createElement('span'),
  CaseSensitive: () => React.createElement('span'),
  // Dialog primitive's close button uses `X` from lucide-react. The curated
  // models modal in EditorPage pulls Dialog in transitively even when it
  // isn't open, so the lucide-react mock has to cover X too.
  X: () => React.createElement('span'),
  // perspective-registry icons (ActivityBar now imports from perspective-registry)
  FolderOpen: () => React.createElement('span'),
  GitBranch: () => React.createElement('span'),
  Package: () => React.createElement('span'),
  Boxes: () => React.createElement('span')
}));

vi.mock('../../src/components/GraphFilterMenu.js', () => ({
  GraphFilterMenu: () => React.createElement('div')
}));

vi.mock('../../src/shell/DockShell.js', () => {
  // Match WorkbenchHost's stable bridge rather than remounting changing render callbacks.
  const PanelBody = ({ render }: { render: (props: object) => React.ReactElement | null }) => render({});
  return {
    DockShell: ({
      panelComponents,
      focusPanel
    }: {
      panelComponents?: Record<string, (props: object) => React.ReactElement | null>;
      focusPanel?: { component: string; nonce: number } | null;
    }) => {
      dockShellMockState.latestProps = { focusPanel };
      return React.createElement('div', { 'data-testid': 'dock-shell' }, [
        panelComponents?.['workspace.fileTree']
          ? React.createElement(PanelBody, { render: panelComponents['workspace.fileTree'], key: 'fileTree' })
          : null,
        panelComponents?.['workspace.editor']
          ? React.createElement(PanelBody, { render: panelComponents['workspace.editor'], key: 'editor' })
          : null,
        panelComponents?.['workspace.visualPreview']
          ? React.createElement(PanelBody, { render: panelComponents['workspace.visualPreview'], key: 'visual' })
          : null,
        panelComponents?.['workspace.problems']
          ? React.createElement(PanelBody, { render: panelComponents['workspace.problems'], key: 'problems' })
          : null
      ]);
    }
  };
});

vi.mock('../../src/shell/panels/CenterStackPanel.js', () => ({
  // Simplified stub: renders all four panes by default so that
  // StructureView is always mounted when VisualPreviewPanelMounted renders.
  // This surfaces the cellComponents wiring in EditorPage — an earlier
  // regression had cell editors built but never passed to StructureView
  // (same class as the Phase 7 integration miss fixed by PR #185).
  // renderSource is included so SourceEditor (inside renderSourcePane) is
  // still mounted — other tests rely on SourceEditor being rendered.
  CenterStackPanel: function CenterStackPanelMock({
    renderStructure,
    renderGraph,
    renderSource,
    renderInspector
  }: {
    renderGraph?: () => React.ReactElement | null;
    renderSource?: () => React.ReactElement | null;
    renderInspector?: () => React.ReactElement | null;
    renderStructure?: () => React.ReactElement | null;
  }) {
    const sourceNavigationPending = React.useContext(SourceNavigationFeedbackContext);
    const [showGraph, setShowGraph] = React.useState(centerStackMockState.showGraph);
    centerStackMockState.setShowGraph = setShowGraph;
    return React.createElement(
      'div',
      { 'data-testid': 'center-stack-mock', 'data-source-pending': Boolean(sourceNavigationPending) },
      showGraph ? (renderGraph?.() ?? null) : null,
      sourceEditorMockState.showSource ? (renderSource?.() ?? null) : null,
      renderInspector?.() ?? null,
      renderStructure?.() ?? null
    );
  }
}));

vi.mock('../../src/hooks/useLspDiagnosticsBridge.js', () => ({
  useLspDiagnosticsBridge: () => undefined
}));

vi.mock('../../src/store/diagnostics-store.js', () => ({
  useDiagnosticsStore
}));

vi.mock('../../src/components/CodePreviewPanel.js', () => ({
  CodePreviewPanel: () => React.createElement('div')
}));

vi.mock('../../src/components/FormPreviewPanel.js', () => ({
  FormPreviewPanel: () => React.createElement('div')
}));

vi.mock('../../src/utils/uri.js', () => ({
  pathToUri: (path: string) => `file://${path}`,
  uriToPath: (uri: string) => uri.replace(/^file:\/\/\/?workspace\//, '').replace(/^file:\/\//, '')
}));

import { renderEditorPage } from './editor-page-harness.js';

function modelWithType(typeName: string) {
  return {
    name: 'preview.alpha',
    $document: {
      uri: { path: '/preview-alpha.rosetta', toString: () => '/preview-alpha.rosetta' }
    },
    elements: [
      {
        name: typeName,
        $document: {
          uri: { path: '/preview-alpha.rosetta', toString: () => '/preview-alpha.rosetta' }
        },
        $cstNode: {
          range: {
            start: { line: 8, character: 0 },
            end: { line: 12, character: 0 }
          }
        }
      }
    ]
  };
}

describe('EditorPage preview target identity', () => {
  beforeEach(() => {
    vi.stubGlobal('Worker', MockWorker);
    stubResizeObserver();
    MockWorker.instances = [];
    setRuneStudioTestApi(() => undefined);
    usePreviewStore.getState().resetPreviewState();
    editorStoreState.nodes = [];
    editorStoreState.edges = [];
    editorStoreState.selectedNodeId = undefined;
    editorStoreState.hydrationNonce = 0;
    vi.clearAllMocks();
    sourceEditorMockState.latestProps = undefined;
    dockShellMockState.latestProps = undefined;
    runeTypeGraphMockState.latestConfig = undefined;
    runeTypeGraphMockState.latestCallbacks = undefined;
    runeTypeGraphMockState.fitView = vi.fn();
    runeTypeGraphMockState.relayout = vi.fn();
    resizeObserverMockState.instances = [];
    centerStackMockState.showGraph = true;
    centerStackMockState.setShowGraph = undefined;
    namespaceExplorerMockState.latestProps = undefined;
    // EditorPage embeds PerspectiveHost; store defaults to 'workspaces' which
    // renders WorkspacesPerspective (requires context). These tests render a
    // loaded workspace — reset to 'explore' so DockShell is visible.
    usePerspectiveStore.setState({ activePerspective: 'explore' });
  });

  afterEach(() => {
    setRuneStudioTestApi(() => undefined);
    vi.unstubAllGlobals();
    cleanup();
  });

  it('forwards the selected function operation through the Inspector adapter', async () => {
    editorStoreState.nodes = [
      {
        id: 'preview.alpha.Calculate#RosettaFunction',
        data: { namespace: 'preview.alpha', name: 'Calculate', $type: 'RosettaFunction' },
        meta: { namespace: 'preview.alpha', errors: [], hasExternalRefs: false }
      }
    ];
    editorStoreState.selectedNodeId = editorStoreState.nodes[0]!.id;
    inspectorMockState.actions = undefined;
    renderEditorPage({
      models: [],
      files: [
        { name: 'calculate.rosetta', path: 'calculate.rosetta', content: 'namespace preview.alpha', dirty: false }
      ]
    });
    await waitFor(() => expect(inspectorMockState.actions).toBeDefined());
    act(() => inspectorMockState.actions!.updateExpression(editorStoreState.selectedNodeId!, '42', 1));
    expect(editorStoreState.updateExpression).toHaveBeenCalledExactlyOnceWith(
      'preview.alpha.Calculate#RosettaFunction',
      '42',
      1
    );
  });

  it('posts preview:generate using the selected node kind-aware id when display names collide', async () => {
    editorStoreState.nodes = [
      {
        id: 'alpha.Trade#Data',
        data: { namespace: 'alpha', name: 'Trade', $type: 'Data' },
        meta: { namespace: 'alpha', errors: [], hasExternalRefs: false }
      },
      {
        id: 'beta.Trade#Data',
        data: { namespace: 'beta', name: 'Trade', $type: 'Data' },
        meta: { namespace: 'beta', errors: [], hasExternalRefs: false }
      }
    ];
    editorStoreState.selectedNodeId = 'beta.Trade#Data';

    const _view = renderEditorPage({
      models: [],
      files: [{ name: 'trade.rosetta', path: 'trade.rosetta', content: 'namespace beta', dirty: false }]
    });

    await waitFor(() => {
      expect(MockWorker.instances).toHaveLength(1);
      expect(MockWorker.instances[0]?.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'preview:generate',
          targetId: 'beta.Trade#Data',
          requestId: expect.any(String)
        })
      );
    });

    expect(usePreviewStore.getState().selectedTargetId).toBe('beta.Trade#Data');
  });

  it('re-generates preview for a renamed target after the previous selection is transiently cleared', async () => {
    editorStoreState.nodes = [
      {
        id: 'preview.alpha.Trade',
        data: { namespace: 'preview.alpha', name: 'Trade', $type: 'data' },
        meta: { namespace: 'preview.alpha', errors: [], hasExternalRefs: false }
      }
    ];
    editorStoreState.selectedNodeId = 'preview.alpha.Trade';

    const { rerenderEditorPage } = renderEditorPage({
      models: [modelWithType('Trade') as never],
      files: [
        {
          name: 'preview-alpha.rosetta',
          path: 'preview-alpha.rosetta',
          content: 'namespace preview.alpha',
          dirty: false
        }
      ]
    });

    await waitFor(() => {
      expect(MockWorker.instances).toHaveLength(1);
      expect(MockWorker.instances[0]?.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'preview:generate',
          targetId: 'preview.alpha.Trade',
          requestId: expect.any(String)
        })
      );
    });

    editorStoreState.nodes = [];
    rerenderEditorPage({
      models: [],
      files: [
        {
          name: 'preview-alpha.rosetta',
          path: 'preview-alpha.rosetta',
          content: 'namespace preview.alpha',
          dirty: true
        }
      ]
    });

    editorStoreState.nodes = [
      {
        id: 'preview.alpha.RenamedTrade',
        data: { namespace: 'preview.alpha', name: 'RenamedTrade', $type: 'data' },
        meta: { namespace: 'preview.alpha', errors: [], hasExternalRefs: false }
      }
    ];
    rerenderEditorPage({
      models: [modelWithType('RenamedTrade') as never],
      files: [
        {
          name: 'preview-alpha.rosetta',
          path: 'preview-alpha.rosetta',
          content: 'namespace preview.alpha',
          dirty: true
        }
      ]
    });

    await waitFor(() => {
      expect(usePreviewStore.getState().selectedTargetId).toBe('preview.alpha.RenamedTrade');
      expect(MockWorker.instances[0]?.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'preview:generate',
          targetId: 'preview.alpha.RenamedTrade',
          requestId: expect.any(String)
        })
      );
    });
  });

  it('re-syncs preview files when workspace files change without re-posting duplicate preview:generate messages', async () => {
    editorStoreState.nodes = [
      {
        id: 'preview.alpha.Trade',
        data: { namespace: 'preview.alpha', name: 'Trade', $type: 'data' },
        meta: { namespace: 'preview.alpha', errors: [], hasExternalRefs: false }
      }
    ];
    editorStoreState.selectedNodeId = 'preview.alpha.Trade';

    const { rerenderEditorPage } = renderEditorPage({
      models: [modelWithType('Trade') as never],
      files: [
        {
          name: 'preview-alpha.rosetta',
          path: 'preview-alpha.rosetta',
          content: 'namespace preview.alpha',
          dirty: false
        }
      ]
    });

    await waitFor(() => {
      expect(MockWorker.instances).toHaveLength(1);
    });

    const worker = MockWorker.instances[0]!;
    const initialGenerateCount = worker.postMessage.mock.calls.filter(
      ([message]) =>
        (message as { type?: string; targetId?: string }).type === 'preview:generate' &&
        (message as { targetId?: string }).targetId === 'preview.alpha.Trade'
    ).length;
    const initialSetFilesCount = worker.postMessage.mock.calls.filter(
      ([message]) => (message as { type?: string }).type === 'preview:setFiles'
    ).length;

    rerenderEditorPage({
      models: [modelWithType('Trade') as never],
      files: [
        {
          name: 'preview-alpha.rosetta',
          path: 'preview-alpha.rosetta',
          content: 'namespace preview.alpha\n\ntype Trade:\n  settlementDate string (0..1)',
          dirty: true
        }
      ]
    });

    await waitFor(() => {
      const refreshedSetFilesCount = worker.postMessage.mock.calls.filter(
        ([message]) => (message as { type?: string }).type === 'preview:setFiles'
      ).length;
      const refreshedGenerateCount = worker.postMessage.mock.calls.filter(
        ([message]) =>
          (message as { type?: string; targetId?: string }).type === 'preview:generate' &&
          (message as { targetId?: string }).targetId === 'preview.alpha.Trade'
      ).length;
      expect(refreshedSetFilesCount).toBeGreaterThan(initialSetFilesCount);
      expect(refreshedGenerateCount).toBe(initialGenerateCount);
      const setFilesRequestIds = worker.postMessage.mock.calls
        .filter(([message]) => (message as { type?: string }).type === 'preview:setFiles')
        .map(([message]) => (message as { requestId?: string }).requestId)
        .filter(Boolean);
      expect(new Set(setFilesRequestIds).size).toBe(setFilesRequestIds.length);
      const codegenSetFilesMessages = worker.postMessage.mock.calls
        .map(([message]) => message as { type?: string; requestId?: string })
        .filter((message) => message.type === 'codegen:setFiles');
      expect(codegenSetFilesMessages.length).toBeGreaterThan(0);
      expect(codegenSetFilesMessages.every((message) => message.requestId?.startsWith('codegen:'))).toBe(true);
      expect(codegenSetFilesMessages.every((message) => !message.requestId?.startsWith('preview:'))).toBe(true);
    });
  });

  it('ignores out-of-order stale preview responses for the same target', async () => {
    editorStoreState.nodes = [
      {
        id: 'preview.alpha.Trade',
        data: { namespace: 'preview.alpha', name: 'Trade', $type: 'data' },
        meta: { namespace: 'preview.alpha', errors: [], hasExternalRefs: false }
      }
    ];
    editorStoreState.selectedNodeId = 'preview.alpha.Trade';

    const { rerenderEditorPage } = renderEditorPage({
      models: [modelWithType('Trade') as never],
      files: [
        {
          name: 'preview-alpha.rosetta',
          path: 'preview-alpha.rosetta',
          content: 'namespace preview.alpha',
          dirty: false
        }
      ]
    });

    await waitFor(() => {
      expect(MockWorker.instances).toHaveLength(1);
    });

    const worker = MockWorker.instances[0]!;
    const originalRequestId = worker.postMessage.mock.calls
      .map(([message]) => message as { type?: string; requestId?: string })
      .find((message) => message.type === 'preview:generate')?.requestId;

    rerenderEditorPage({
      models: [modelWithType('Trade') as never],
      files: [
        {
          name: 'preview-alpha.rosetta',
          path: 'preview-alpha.rosetta',
          content: 'namespace preview.alpha\n\ntype Trade:\n  settlementDate string (0..1)',
          dirty: true
        }
      ]
    });

    const latestRequestId = worker.postMessage.mock.calls
      .map(([message]) => message as { type?: string; requestId?: string })
      .filter((message) => message.type === 'preview:setFiles')
      .at(-1)?.requestId;

    await act(async () => {
      worker.dispatch('message', {
        data: {
          type: 'preview:result',
          targetId: 'preview.alpha.Trade',
          requestId: originalRequestId,
          schema: {
            schemaVersion: 1,
            targetId: 'preview.alpha.Trade',
            title: 'Old Trade',
            status: 'ready',
            fields: []
          }
        }
      });
    });

    expect(usePreviewStore.getState().schemas.get('preview.alpha.Trade')).toBeUndefined();

    await act(async () => {
      worker.dispatch('message', {
        data: {
          type: 'preview:result',
          targetId: 'preview.alpha.Trade',
          requestId: latestRequestId,
          schema: {
            schemaVersion: 1,
            targetId: 'preview.alpha.Trade',
            title: 'Trade',
            status: 'ready',
            fields: []
          }
        }
      });
    });

    expect(usePreviewStore.getState().schemas.get('preview.alpha.Trade')?.title).toBe('Trade');
  });

  it('derives preview target source identity from parsedModels when worker-cloned models lack document metadata', async () => {
    editorStoreState.nodes = [
      {
        id: 'preview.alpha.Trade',
        data: { namespace: 'preview.alpha', name: 'Trade', $type: 'data' },
        meta: { namespace: 'preview.alpha', errors: [], hasExternalRefs: false }
      }
    ];
    editorStoreState.selectedNodeId = 'preview.alpha.Trade';

    const parsedModel = {
      name: 'preview.alpha',
      elements: [{ name: 'Trade' }]
    };

    renderEditorPage({
      models: [parsedModel as never],
      parsedModels: [{ filePath: '/preview-alpha.rosetta', model: parsedModel as never }],
      files: [
        {
          name: 'preview-alpha.rosetta',
          path: '/preview-alpha.rosetta',
          content: 'namespace preview.alpha',
          dirty: false
        }
      ]
    });

    await waitFor(() => {
      expect(usePreviewStore.getState().selectedTarget).toMatchObject({
        id: 'preview.alpha.Trade',
        sourceUri: 'file:///preview-alpha.rosetta',
        sourceIndex: 0
      });
    });
  });

  it('marks preview stale when a cached schema exists and the worker later crashes', async () => {
    editorStoreState.nodes = [
      {
        id: 'preview.alpha.Trade',
        data: { namespace: 'preview.alpha', name: 'Trade', $type: 'data' },
        meta: { namespace: 'preview.alpha', errors: [], hasExternalRefs: false }
      }
    ];
    editorStoreState.selectedNodeId = 'preview.alpha.Trade';

    renderEditorPage({
      models: [modelWithType('Trade') as never],
      files: [
        {
          name: 'preview-alpha.rosetta',
          path: 'preview-alpha.rosetta',
          content: 'namespace preview.alpha',
          dirty: false
        }
      ]
    });

    await waitFor(() => {
      expect(MockWorker.instances).toHaveLength(1);
    });

    const worker = MockWorker.instances[0]!;
    const requestId = worker.postMessage.mock.calls
      .map(([message]) => message as { type?: string; requestId?: string })
      .find((message) => message.type === 'preview:generate')?.requestId;

    await act(async () => {
      worker.dispatch('message', {
        data: {
          type: 'preview:result',
          targetId: 'preview.alpha.Trade',
          requestId,
          schema: {
            schemaVersion: 1,
            targetId: 'preview.alpha.Trade',
            title: 'Trade',
            status: 'ready',
            fields: []
          }
        }
      });
    });

    await act(async () => {
      worker.dispatch('error', { type: 'error', message: 'worker crashed' });
    });

    expect(usePreviewStore.getState().status).toEqual({
      state: 'stale',
      targetId: 'preview.alpha.Trade',
      reason: 'generation-error',
      message: 'Preview worker crashed. worker crashed'
    });
  });

  it('marks preview unavailable when the worker rejects a message before any schema is cached', async () => {
    editorStoreState.nodes = [
      {
        id: 'preview.alpha.Trade',
        data: { namespace: 'preview.alpha', name: 'Trade', $type: 'data' },
        meta: { namespace: 'preview.alpha', errors: [], hasExternalRefs: false }
      }
    ];
    editorStoreState.selectedNodeId = 'preview.alpha.Trade';

    renderEditorPage({
      models: [modelWithType('Trade') as never],
      files: [
        {
          name: 'preview-alpha.rosetta',
          path: 'preview-alpha.rosetta',
          content: 'namespace preview.alpha',
          dirty: false
        }
      ]
    });

    await waitFor(() => {
      expect(MockWorker.instances).toHaveLength(1);
    });

    await act(async () => {
      MockWorker.instances[0]!.dispatch('messageerror', { type: 'messageerror' });
    });

    expect(usePreviewStore.getState().status).toEqual({
      state: 'unavailable',
      targetId: 'preview.alpha.Trade',
      reason: 'generation-error',
      message: 'Preview worker rejected a message. A preview worker message could not be deserialized.'
    });
  });

  it('surfaces worker boot failures without crashing the page', async () => {
    setRuneStudioTestApi(() => ({
      createCodegenWorker() {
        throw new Error('worker boot failed');
      }
    }));

    renderEditorPage({
      models: [],
      files: []
    });

    await waitFor(() => {
      expect(usePreviewStore.getState().status).toEqual({
        state: 'unavailable',
        reason: 'generation-error',
        message: 'Preview worker could not start. worker boot failed'
      });
    });
  });

  it('does not let an older LSP timeout cancel a newer same-file request', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      let display: ((uri: string) => Promise<unknown>) | undefined;
      const input = {
        models: [],
        files: [{ path: 'beta.rosetta', name: 'beta.rosetta', content: 'namespace beta', dirty: false }],
        lspClient: {
          onDisplayFile: (handler: typeof display) => {
            display = handler;
            return () => {};
          }
        } as never
      };
      sourceEditorMockState.showSource = false;
      const view = renderEditorPage(input);
      act(() => {
        void display?.('file:///beta.rosetta');
      });
      act(() => vi.advanceTimersByTime(1000));
      let newer: Promise<unknown> | undefined;
      act(() => {
        newer = display?.('file:///beta.rosetta');
      });
      act(() => vi.advanceTimersByTime(1000));
      expect(screen.getByTestId('center-stack-mock')).toHaveAttribute('data-source-pending', 'true');
      sourceEditorMockState.showSource = true;
      view.rerenderEditorPage(input);
      await expect(newer).resolves.toEqual({ id: 'beta.rosetta' });
    } finally {
      sourceEditorMockState.showSource = true;
      vi.useRealTimers();
    }
  });

  it('tracks an LSP file navigation until its editor view arrives', async () => {
    let display: ((uri: string) => Promise<unknown>) | undefined;
    const input = {
      models: [],
      files: [{ path: 'beta.rosetta', name: 'beta.rosetta', content: 'namespace beta', dirty: false }],
      lspClient: {
        onDisplayFile: (handler: typeof display) => {
          display = handler;
          return () => {};
        }
      } as never
    };
    sourceEditorMockState.showSource = false;
    const view = renderEditorPage(input);
    let result: Promise<unknown> | undefined;
    act(() => {
      result = display?.('file:///beta.rosetta');
    });
    expect(screen.getByTestId('center-stack-mock')).toHaveAttribute('data-source-pending', 'true');
    sourceEditorMockState.showSource = true;
    view.rerenderEditorPage(input);
    await act(async () => {
      await result;
    });
    expect(screen.getByTestId('center-stack-mock')).toHaveAttribute('data-source-pending', 'false');
  });

  it('resolves displayFile by opening the matching source file and returning its editor view', async () => {
    let displayFileHandler: ((uri: string) => Promise<{ id: string } | null>) | undefined;
    const lspClient = {
      onDisplayFile: vi.fn((handler: (uri: string) => Promise<{ id: string } | null>) => {
        displayFileHandler = handler;
        return vi.fn();
      })
    };

    const _view = renderEditorPage({
      models: [],
      files: [
        {
          path: '/workspace/alpha.rosetta',
          name: 'alpha.rosetta',
          content: 'namespace alpha',
          dirty: false
        },
        {
          path: '/workspace/beta.rosetta',
          name: 'beta.rosetta',
          content: 'namespace beta',
          dirty: false
        }
      ],
      lspClient: lspClient as never
    });

    await waitFor(() => {
      expect(displayFileHandler).toBeDefined();
    });

    let pendingView: Promise<{ id: string } | null> | undefined;
    await act(async () => {
      pendingView = displayFileHandler?.('file:///workspace/beta.rosetta');
    });
    await waitFor(() => {
      expect(sourceEditorMockState.latestProps?.activeFile).toBe('/workspace/beta.rosetta');
    });
    sourceEditorMockState.latestProps?.onEditorViewCreated?.('/workspace/beta.rosetta', {
      id: '/workspace/beta.rosetta'
    });
    await expect(pendingView).resolves.toEqual({ id: '/workspace/beta.rosetta' });

    await waitFor(() => {
      expect(screen.getByTestId('source-editor-mock')).toHaveAttribute('data-active-file', '/workspace/beta.rosetta');
    });
  });
});

describe('EditorPage workspace chrome', () => {
  beforeEach(() => {
    vi.stubGlobal('Worker', MockWorker);
    centerStackMockState.showGraph = true;
    centerStackMockState.setShowGraph = undefined;
    MockWorker.instances = [];
    setRuneStudioTestApi(() => undefined);
    usePreviewStore.getState().resetPreviewState();
    // EditorPage represents a loaded workspace — Explore must be active so
    // PerspectiveHost renders DockShell (not hidden by display:none).
    usePerspectiveStore.setState({ activePerspective: 'explore' });
    useExploreFileNavStore.setState({ activeEditorFile: undefined, syncStatus: null });
    editorStoreState.nodes = [];
    editorStoreState.selectedNodeId = undefined;
    vi.clearAllMocks();
    sourceEditorMockState.latestProps = undefined;
    dockShellMockState.latestProps = undefined;
    runeTypeGraphMockState.latestCallbacks = undefined;
    namespaceExplorerMockState.latestProps = undefined;
  });

  afterEach(() => {
    setRuneStudioTestApi(() => undefined);
    vi.unstubAllGlobals();
    cleanup();
  });

  it('reveals the selected curated declaration after source arrives without changing the selection', async () => {
    const path = 'cdm/datetime.rosetta';
    const name = 'BusinessCenters';
    const namespace = 'cdm.base.datetime';
    editorStoreState.nodes = [
      {
        id: `${namespace}.${name}#Data`,
        data: { name, $type: 'Data' },
        meta: { namespace, errors: [], hasExternalRefs: false, deferred: true }
      }
    ];
    editorStoreState.selectedNodeId = editorStoreState.nodes[0]!.id;
    const file = {
      name: 'datetime.rosetta',
      path,
      content: '',
      dirty: false,
      readOnly: true,
      refOnly: true,
      namespace
    };
    const deferredExports = [{ namespace, filePath: path, exports: [{ name, type: 'Data' }] }];
    const props = { files: [file], deferredExports };
    const { rerenderEditorPage } = renderEditorPage(props);
    expect(sourceEditorMockState.revealLine).not.toHaveBeenCalled();

    const content = 'namespace cdm.base.datetime\n\ntype BusinessCentersExtra:\n\ntype BusinessCenters:\n';
    rerenderEditorPage({ ...props, files: [{ ...file, content, sourceLoaded: true }] });
    await waitFor(() => expect(sourceEditorMockState.revealLine).toHaveBeenCalledWith(5, path));
    expect(sourceEditorMockState.revealLine).not.toHaveBeenCalledWith(1, path);
  });

  it('renders a workspace header and keeps graph controls inside the graph panel', () => {
    const _view = renderEditorPage({
      models: [],
      files: [{ name: 'trade.rosetta', path: 'trade.rosetta', content: 'namespace alpha', dirty: false }],
      workspaceName: 'CDM Workspace',
      onClose: vi.fn()
    });

    expect(screen.getByLabelText('Studio workspace header')).toBeInTheDocument();
    expect(screen.getByText('Rune Studio')).toBeInTheDocument();
    expect(screen.getByText('CDM Workspace')).toBeInTheDocument();
    expect(screen.getByText('1 file')).toBeInTheDocument();
    expect(screen.getByText('Import')).toBeInTheDocument();

    const graphToolbar = screen.getByLabelText('Graph toolbar');
    expect(graphToolbar).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fit View' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Re-layout' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Grouped' })).toBeInTheDocument();
  });

  it('opening a file via the tab strip (explore-file-nav-store) is reflected by the source editor — behavior preserved after the useState→store lift', () => {
    renderEditorPage({
      models: [],
      files: [
        { name: 'alpha.rosetta', path: 'alpha.rosetta', content: 'namespace alpha', dirty: false },
        { name: 'beta.rosetta', path: 'beta.rosetta', content: 'namespace beta', dirty: false }
      ]
    });

    // The files-loaded effect auto-selects the first file as active.
    expect(sourceEditorMockState.latestProps?.activeFile).toBe('alpha.rosetta');

    // Clicking a different tab calls onSelectFile (bound to openFileInSource),
    // which now writes explore-file-nav-store instead of local useState.
    // Exact match (issue #405): a substring regex would also match the
    // tab's "Delete beta.rosetta" button.
    fireEvent.click(screen.getByRole('button', { name: 'beta.rosetta' }));

    // The store write is observed by an unrelated consumer (SourceEditor's
    // activeFile prop) exactly as the old local useState flow was — single
    // source, no duplication.
    expect(sourceEditorMockState.latestProps?.activeFile).toBe('beta.rosetta');
    expect(useExploreFileNavStore.getState().activeEditorFile).toBe('beta.rosetta');
  });

  it('requests inspector focus when a node is selected', async () => {
    editorStoreState.nodes = [
      {
        id: 'cdm.base.datetime.AdjustableDate',
        data: { namespace: 'cdm.base.datetime', name: 'AdjustableDate', $type: 'data' },
        meta: { namespace: 'cdm.base.datetime', errors: [], hasExternalRefs: false }
      }
    ];
    editorStoreState.selectedNodeId = 'cdm.base.datetime.AdjustableDate';

    renderEditorPage({
      models: [],
      files: [
        {
          name: 'base-datetime-type.rosetta',
          path: 'base-datetime-type.rosetta',
          content: 'namespace cdm.base.datetime',
          dirty: false
        }
      ]
    });

    await waitFor(() => {
      expect(dockShellMockState.latestProps?.focusPanel).toEqual({
        component: 'workspace.inspector',
        nonce: 1
      });
    });
  });

  it('shows a destructive toast when navigating to a type that is not loaded', () => {
    editorStoreState.nodes = [
      {
        id: 'cdm.base.datetime.AdjustableDate',
        data: { namespace: 'cdm.base.datetime', name: 'AdjustableDate', $type: 'data' },
        meta: { namespace: 'cdm.base.datetime', errors: [], hasExternalRefs: false }
      }
    ];

    renderEditorPage({
      models: [],
      files: [
        {
          name: 'base-datetime-type.rosetta',
          path: 'base-datetime-type.rosetta',
          content: 'namespace cdm.base.datetime',
          dirty: false
        }
      ]
    });

    act(() => {
      runeTypeGraphMockState.latestCallbacks?.onNavigateToType?.('cdm.base.datetime.GhostType');
    });

    expect(showToastSpy).toHaveBeenCalledWith({
      description: 'Type "GhostType" not loaded — load the file containing this type',
      variant: 'destructive',
      duration: 3000
    });
  });

  it('selects explorer nodes without re-centering the graph view', () => {
    editorStoreState.edges = [];
    editorStoreState.nodes = [
      {
        id: 'cdm.base.datetime.AdjustableDate',
        data: { namespace: 'cdm.base.datetime', name: 'AdjustableDate', $type: 'data' },
        meta: { namespace: 'cdm.base.datetime', errors: [], hasExternalRefs: false }
      }
    ];

    renderEditorPage({
      models: [],
      files: [
        {
          name: 'base-datetime-type.rosetta',
          path: 'base-datetime-type.rosetta',
          content: 'namespace cdm.base.datetime',
          dirty: false
        }
      ]
    });

    act(() => {
      namespaceExplorerMockState.latestProps?.onSelectNode?.('cdm.base.datetime.AdjustableDate');
    });

    expect(editorStoreState.selectedNodeId).toBe('cdm.base.datetime.AdjustableDate');
    expect(editorStoreState.detailPanelOpen).toBe(true);
    expect(editorStoreState.selectNode).toHaveBeenCalledWith('cdm.base.datetime.AdjustableDate', {
      reapplyFocusMode: true
    });
    expect(runeTypeGraphMockState.focusNode).not.toHaveBeenCalled();
  });

  // Characterization test for Task 5 (route ExplorePerspective's existing
  // hydration triggers through the shared HydrationOrchestrator): asserts
  // the externally-observable behavior — selecting a deferred explorer node
  // still requests hydration for its namespace — is unchanged by that
  // refactor. Written before the refactor as a regression guard, not to
  // drive new behavior (it already passes against the direct
  // requestNamespaceHydration call site).
  it('requests namespace hydration when selecting a deferred explorer node', () => {
    editorStoreState.edges = [];
    editorStoreState.nodes = [
      {
        id: 'cdm.base.staticdata.party.DeferredParty',
        data: { namespace: 'cdm.base.staticdata.party', name: 'DeferredParty', $type: 'data', deferred: true },
        meta: { namespace: 'cdm.base.staticdata.party', errors: [], hasExternalRefs: false, deferred: true }
      }
    ];

    renderEditorPage({
      models: [],
      files: [
        {
          name: 'base-staticdata-party-type.rosetta',
          path: 'base-staticdata-party-type.rosetta',
          content: 'namespace cdm.base.staticdata.party',
          dirty: false
        }
      ]
    });

    act(() => {
      namespaceExplorerMockState.latestProps?.onSelectNode?.('cdm.base.staticdata.party.DeferredParty');
    });

    expect(editorStoreState.selectNode).toHaveBeenCalledWith('cdm.base.staticdata.party.DeferredParty', {
      reapplyFocusMode: true
    });
    expect(editorStoreState.requestNamespaceHydration).toHaveBeenCalledWith('cdm.base.staticdata.party');
  });

  it('re-centers navigation targets that have no graph edges', () => {
    editorStoreState.edges = [];
    editorStoreState.nodes = [
      {
        id: 'cdm.base.datetime.Standalone',
        data: { namespace: 'cdm.base.datetime', name: 'Standalone', $type: 'data' },
        meta: { namespace: 'cdm.base.datetime', errors: [], hasExternalRefs: false }
      }
    ];

    renderEditorPage({
      models: [],
      files: [
        {
          name: 'base-datetime-type.rosetta',
          path: 'base-datetime-type.rosetta',
          content: 'namespace cdm.base.datetime',
          dirty: false
        }
      ]
    });

    act(() => {
      runeTypeGraphMockState.latestCallbacks?.onNavigateToType?.('cdm.base.datetime.Standalone');
    });

    expect(editorStoreState.selectNode).toHaveBeenCalledWith('cdm.base.datetime.Standalone', {
      reapplyFocusMode: true
    });
    expect(runeTypeGraphMockState.focusNode).not.toHaveBeenCalled();
  });

  it('requests namespace hydration when navigating directly to a deferred curated type', () => {
    editorStoreState.edges = [];
    editorStoreState.nodes = [
      {
        id: 'cdm.base.datetime.DeferredDate',
        data: { namespace: 'cdm.base.datetime', name: 'DeferredDate', $type: 'data', deferred: true },
        meta: { namespace: 'cdm.base.datetime', errors: [], hasExternalRefs: false, deferred: true }
      }
    ];

    renderEditorPage({
      models: [],
      files: [
        {
          name: 'base-datetime-type.rosetta',
          path: 'base-datetime-type.rosetta',
          content: 'namespace cdm.base.datetime',
          dirty: false
        }
      ]
    });

    act(() => {
      runeTypeGraphMockState.latestCallbacks?.onNavigateToType?.('cdm.base.datetime.DeferredDate');
    });

    expect(editorStoreState.selectNode).toHaveBeenCalledWith('cdm.base.datetime.DeferredDate', {
      reapplyFocusMode: true
    });
    expect(editorStoreState.requestNamespaceHydration).toHaveBeenCalledWith('cdm.base.datetime');
  });

  it('merges workspace parse errors into the Problems panel alongside LSP diagnostics', () => {
    diagnosticsState.fileDiagnostics = new Map([
      [
        'file:///workspace/trade.rosetta',
        [
          {
            range: {
              start: { line: 2, character: 0 },
              end: { line: 2, character: 5 }
            },
            severity: 2,
            source: 'lsp',
            message: 'Suspicious cardinality'
          }
        ]
      ]
    ]);
    diagnosticsState.totalErrors = 0;
    diagnosticsState.totalWarnings = 1;

    renderEditorPage({
      parseErrors: new Map([['trade.rosetta', ['Expected ":" after type declaration']]]),
      files: [
        {
          name: 'trade.rosetta',
          path: 'trade.rosetta',
          content: 'namespace example\ntype Trade\n  tradeId string (1..1)\n',
          dirty: true
        }
      ]
    });

    const merged = diagnosticsPanelMockState.latestProps?.fileDiagnostics;
    expect(merged?.get('trade.rosetta')).toEqual([
      expect.objectContaining({
        severity: 1,
        source: 'parser',
        message: 'Expected ":" after type declaration'
      }),
      expect.objectContaining({
        severity: 2,
        source: 'lsp',
        message: 'Suspicious cardinality'
      })
    ]);
  });

  it('does not count info diagnostics as errors in the footer totals', () => {
    diagnosticsState.fileDiagnostics = new Map([
      [
        'file:///workspace/trade.rosetta',
        [
          {
            range: {
              start: { line: 2, character: 0 },
              end: { line: 2, character: 5 }
            },
            severity: 3,
            source: 'lsp',
            message: 'Informational hint'
          }
        ]
      ]
    ]);
    diagnosticsState.totalErrors = 0;
    diagnosticsState.totalWarnings = 0;

    renderEditorPage({
      files: [
        {
          name: 'trade.rosetta',
          path: 'trade.rosetta',
          content: 'namespace example\ntype Trade:\n  tradeId string (1..1)\n',
          dirty: false
        }
      ]
    });

    expect(screen.queryByText(/err \/ .*warn/)).not.toBeInTheDocument();
  });

  it('re-centers connected navigation targets when focus mode hides nothing', () => {
    editorStoreState.nodes = [
      {
        id: 'cdm.base.datetime.AdjustableDate',
        data: { namespace: 'cdm.base.datetime', name: 'AdjustableDate', $type: 'data' },
        meta: { namespace: 'cdm.base.datetime', errors: [], hasExternalRefs: false }
      },
      {
        id: 'cdm.base.datetime.BusinessCenter',
        data: { namespace: 'cdm.base.datetime', name: 'BusinessCenter', $type: 'data' },
        meta: { namespace: 'cdm.base.datetime', errors: [], hasExternalRefs: false }
      }
    ];
    editorStoreState.edges = [
      { source: 'cdm.base.datetime.AdjustableDate', target: 'cdm.base.datetime.BusinessCenter' }
    ];
    editorStoreState.selectedNodeId = 'cdm.base.datetime.AdjustableDate';

    renderEditorPage({
      models: [],
      files: [
        {
          name: 'base-datetime-type.rosetta',
          path: 'base-datetime-type.rosetta',
          content: 'namespace cdm.base.datetime',
          dirty: false
        }
      ]
    });

    act(() => {
      runeTypeGraphMockState.latestCallbacks?.onNavigateToType?.('cdm.base.datetime.BusinessCenter');
    });

    expect(runeTypeGraphMockState.focusNode).not.toHaveBeenCalled();

    runeTypeGraphMockState.focusNode.mockClear();

    fireEvent.keyDown(screen.getByTestId('explore-workbench'), { key: 'ArrowLeft', altKey: true });

    expect(runeTypeGraphMockState.focusNode).not.toHaveBeenCalled();
  });

  it('shows a destructive toast when navigating back to a node that is no longer in the graph', () => {
    editorStoreState.nodes = [
      {
        id: 'cdm.base.datetime.AdjustableDate',
        data: { namespace: 'cdm.base.datetime', name: 'AdjustableDate', $type: 'data' },
        meta: { namespace: 'cdm.base.datetime', errors: [], hasExternalRefs: false }
      },
      {
        id: 'cdm.base.datetime.BusinessCenter',
        data: { namespace: 'cdm.base.datetime', name: 'BusinessCenter', $type: 'data' },
        meta: { namespace: 'cdm.base.datetime', errors: [], hasExternalRefs: false }
      }
    ];
    editorStoreState.selectedNodeId = 'cdm.base.datetime.AdjustableDate';

    const view = renderEditorPage({
      models: [],
      files: [
        {
          name: 'base-datetime-type.rosetta',
          path: 'base-datetime-type.rosetta',
          content: 'namespace cdm.base.datetime',
          dirty: false
        }
      ]
    });

    act(() => {
      runeTypeGraphMockState.latestCallbacks?.onNavigateToType?.('cdm.base.datetime.BusinessCenter');
    });

    editorStoreState.nodes = [
      {
        id: 'cdm.base.datetime.BusinessCenter',
        data: { namespace: 'cdm.base.datetime', name: 'BusinessCenter', $type: 'data' },
        meta: { namespace: 'cdm.base.datetime', errors: [], hasExternalRefs: false }
      }
    ];
    view.rerenderEditorPage({
      models: [],
      files: [
        {
          name: 'base-datetime-type.rosetta',
          path: 'base-datetime-type.rosetta',
          content: 'namespace cdm.base.datetime',
          dirty: false
        }
      ]
    });

    fireEvent.keyDown(screen.getByTestId('explore-workbench'), { key: 'ArrowLeft', altKey: true });

    expect(showToastSpy).toHaveBeenCalledWith({
      description: 'Previous node "cdm.base.datetime.AdjustableDate" is no longer in the graph',
      variant: 'destructive',
      duration: 3000
    });
  });

  it('invalidates forward history when a non-history selection (e.g. an Explorer/Structure click) changes the selected node', () => {
    // Regression: forward history used to only get cleared inside
    // navigateToNode. A/B navigated via cross-reference, Back to A, then
    // selecting C via any OTHER path that reaches storeSelectNode directly
    // (Type Explorer, StructureView, RuneTypeGraph's own internal node-click
    // handling) must still invalidate the stale forward entry (B) — Forward
    // should do nothing afterward, not silently jump to B.
    editorStoreState.nodes = [
      {
        id: 'cdm.base.datetime.AdjustableDate',
        data: { namespace: 'cdm.base.datetime', name: 'AdjustableDate', $type: 'data' },
        meta: { namespace: 'cdm.base.datetime', errors: [], hasExternalRefs: false }
      },
      {
        id: 'cdm.base.datetime.BusinessCenter',
        data: { namespace: 'cdm.base.datetime', name: 'BusinessCenter', $type: 'data' },
        meta: { namespace: 'cdm.base.datetime', errors: [], hasExternalRefs: false }
      },
      {
        id: 'cdm.base.datetime.BusinessCenterTime',
        data: { namespace: 'cdm.base.datetime', name: 'BusinessCenterTime', $type: 'data' },
        meta: { namespace: 'cdm.base.datetime', errors: [], hasExternalRefs: false }
      }
    ];
    editorStoreState.selectedNodeId = 'cdm.base.datetime.AdjustableDate';

    renderEditorPage({
      models: [],
      files: [
        {
          name: 'base-datetime-type.rosetta',
          path: 'base-datetime-type.rosetta',
          content: 'namespace cdm.base.datetime',
          dirty: false
        }
      ]
    });

    // A -> B via cross-reference navigation.
    act(() => {
      runeTypeGraphMockState.latestCallbacks?.onNavigateToType?.('cdm.base.datetime.BusinessCenter');
    });

    // Back to A — B is now on the forward stack.
    fireEvent.keyDown(screen.getByTestId('explore-workbench'), { key: 'ArrowLeft', altKey: true });
    expect(editorStoreState.selectedNodeId).toBe('cdm.base.datetime.AdjustableDate');

    // Select C via a non-history path — the same storeSelectNode action
    // handleExplorerSelectNode/StructureView's onNodeSelect/RuneTypeGraph's
    // internal click handling all call directly, bypassing navigateToNode.
    act(() => {
      editorStoreState.selectNode('cdm.base.datetime.BusinessCenterTime');
    });
    expect(editorStoreState.selectedNodeId).toBe('cdm.base.datetime.BusinessCenterTime');

    runeTypeGraphMockState.focusNode.mockClear();

    // Forward must now be a no-op — the stale B entry was invalidated by
    // the C selection, not silently resurrected.
    fireEvent.keyDown(screen.getByTestId('explore-workbench'), { key: 'ArrowRight', altKey: true });
    expect(editorStoreState.selectedNodeId).toBe('cdm.base.datetime.BusinessCenterTime');
    expect(runeTypeGraphMockState.focusNode).not.toHaveBeenCalled();
  });

  it('preserves forward history across a rename of the currently-selected node (renameType side-effect rekey)', () => {
    // Regression: the forward-stack clear used to run unconditionally
    // whenever selectedNodeId changed and the departing id was gone from
    // nodesById — which is also true for renameType's own rekey (delete old
    // id, insert new id, reselect the new id in the same set()). That wiped
    // legitimate forward history (B) that had nothing to do with the rename.
    editorStoreState.nodes = [
      {
        id: 'cdm.base.datetime.AdjustableDate',
        data: { namespace: 'cdm.base.datetime', name: 'AdjustableDate', $type: 'data' },
        meta: { namespace: 'cdm.base.datetime', errors: [], hasExternalRefs: false }
      },
      {
        id: 'cdm.base.datetime.BusinessCenter',
        data: { namespace: 'cdm.base.datetime', name: 'BusinessCenter', $type: 'data' },
        meta: { namespace: 'cdm.base.datetime', errors: [], hasExternalRefs: false }
      }
    ];
    editorStoreState.selectedNodeId = 'cdm.base.datetime.AdjustableDate';

    renderEditorPage({
      models: [],
      files: [
        {
          name: 'base-datetime-type.rosetta',
          path: 'base-datetime-type.rosetta',
          content: 'namespace cdm.base.datetime',
          dirty: false
        }
      ]
    });

    // A -> B via cross-reference navigation.
    act(() => {
      runeTypeGraphMockState.latestCallbacks?.onNavigateToType?.('cdm.base.datetime.BusinessCenter');
    });

    // Back to A — B is now on the forward stack.
    fireEvent.keyDown(screen.getByTestId('explore-workbench'), { key: 'ArrowLeft', altKey: true });
    expect(editorStoreState.selectedNodeId).toBe('cdm.base.datetime.AdjustableDate');

    // Mirrors renameType(nodeId, newName)'s exact real-store side effect
    // (editor-store.ts): the old id is removed from `nodes`, a new node is
    // inserted under the rekeyed id, and selectedNodeId is reassigned to it
    // — all in the same set().
    act(() => {
      useEditorStore.setState({
        nodes: [
          {
            id: 'cdm.base.datetime.AdjustableDateRenamed',
            data: { namespace: 'cdm.base.datetime', name: 'AdjustableDateRenamed', $type: 'data' },
            meta: { namespace: 'cdm.base.datetime', errors: [], hasExternalRefs: false }
          },
          {
            id: 'cdm.base.datetime.BusinessCenter',
            data: { namespace: 'cdm.base.datetime', name: 'BusinessCenter', $type: 'data' },
            meta: { namespace: 'cdm.base.datetime', errors: [], hasExternalRefs: false }
          }
        ],
        selectedNodeId: 'cdm.base.datetime.AdjustableDateRenamed'
      });
    });
    expect(editorStoreState.selectedNodeId).toBe('cdm.base.datetime.AdjustableDateRenamed');

    // Forward must still resolve to B — the rename must not have discarded it.
    fireEvent.keyDown(screen.getByTestId('explore-workbench'), { key: 'ArrowRight', altKey: true });
    expect(editorStoreState.selectedNodeId).toBe('cdm.base.datetime.BusinessCenter');
  });

  it('resets navigation history when the workspace changes (ExplorePerspective is kept mounted across switches)', () => {
    // Regression: PerspectiveHost never unmounts ExplorePerspective across
    // workspace switches (display:none toggling instead), so the history
    // refs would otherwise survive into an unrelated workspace and could
    // resolve to a stale/colliding node id there.
    editorStoreState.nodes = [
      {
        id: 'cdm.base.datetime.AdjustableDate',
        data: { namespace: 'cdm.base.datetime', name: 'AdjustableDate', $type: 'data' },
        meta: { namespace: 'cdm.base.datetime', errors: [], hasExternalRefs: false }
      },
      {
        id: 'cdm.base.datetime.BusinessCenter',
        data: { namespace: 'cdm.base.datetime', name: 'BusinessCenter', $type: 'data' },
        meta: { namespace: 'cdm.base.datetime', errors: [], hasExternalRefs: false }
      }
    ];
    editorStoreState.selectedNodeId = 'cdm.base.datetime.AdjustableDate';

    const { rerenderEditorPage } = renderEditorPage({
      workspaceId: 'ws-a',
      models: [],
      files: [
        {
          name: 'base-datetime-type.rosetta',
          path: 'base-datetime-type.rosetta',
          content: 'namespace cdm.base.datetime',
          dirty: false
        }
      ]
    });

    // A -> B — A is now on the back stack.
    act(() => {
      runeTypeGraphMockState.latestCallbacks?.onNavigateToType?.('cdm.base.datetime.BusinessCenter');
    });
    expect(editorStoreState.selectedNodeId).toBe('cdm.base.datetime.BusinessCenter');

    // Switch workspace without unmounting — same shape PerspectiveHost
    // produces in the real app.
    act(() => {
      rerenderEditorPage({
        workspaceId: 'ws-b',
        models: [],
        files: [
          {
            name: 'base-datetime-type.rosetta',
            path: 'base-datetime-type.rosetta',
            content: 'namespace cdm.base.datetime',
            dirty: false
          }
        ]
      });
    });

    // Back must now be a no-op — the workspace switch cleared the stale
    // back-stack entry, so there is nothing to show a toast about either.
    fireEvent.keyDown(screen.getByTestId('explore-workbench'), { key: 'ArrowLeft', altKey: true });
    expect(editorStoreState.selectedNodeId).toBe('cdm.base.datetime.BusinessCenter');
    expect(showToastSpy).not.toHaveBeenCalled();
  });

  it('does not record a history entry when the selected type is deleted (editor-store.ts deleteType side effect)', () => {
    // Regression: deleteType clears selectedNodeId as a side effect when the
    // deleted type was selected — the same store change a real user
    // navigation produces, but not a visit worth remembering, and the
    // deleted id can never be navigated back to anyway. Without the fix
    // (gating the back-stack push on the departing node still existing),
    // this would push the dead id onto history: canGoBack becomes wrongly
    // true and Back first shows "no longer in the graph" and consumes the
    // phantom entry instead of doing nothing (there IS no real previous
    // node here — this is the type's first and only selection).
    editorStoreState.nodes = [
      {
        id: 'cdm.base.datetime.AdjustableDate',
        data: { namespace: 'cdm.base.datetime', name: 'AdjustableDate', $type: 'data' },
        meta: { namespace: 'cdm.base.datetime', errors: [], hasExternalRefs: false }
      }
    ];
    editorStoreState.selectedNodeId = 'cdm.base.datetime.AdjustableDate';

    renderEditorPage({
      models: [],
      files: [
        {
          name: 'base-datetime-type.rosetta',
          path: 'base-datetime-type.rosetta',
          content: 'namespace cdm.base.datetime',
          dirty: false
        }
      ]
    });

    // Mirrors deleteType(nodeId)'s exact real-store side effect (editor-
    // store.ts): the node leaves `nodes` and selectedNodeId is cleared,
    // both in the same set().
    act(() => {
      useEditorStore.setState({ nodes: [], selectedNodeId: undefined });
    });
    expect(editorStoreState.selectedNodeId).toBeUndefined();

    fireEvent.keyDown(screen.getByTestId('explore-workbench'), { key: 'ArrowLeft', altKey: true });
    expect(showToastSpy).not.toHaveBeenCalled();
    expect(editorStoreState.selectedNodeId).toBeUndefined();
  });

  it('clears forward history when a fresh selection follows an edit-driven clear-to-null', () => {
    // Regression: A -> B -> Back-to-A leaves forward=[B]. Deleting the now-
    // selected A clears selectedNodeId to null (edit-driven, forward
    // correctly preserved). But selecting C next is a GENUINE new visit —
    // not a rekey, since there's no departing node left to have been
    // rekeyed (previous is already null) — so it must still invalidate the
    // stale forward=[B]. The previous fix's gate skipped this because it
    // conditioned the forward-clear on the same "previous truthy" check as
    // the back-stack push, which is false here for an unrelated reason.
    editorStoreState.nodes = [
      {
        id: 'cdm.base.datetime.AdjustableDate',
        data: { namespace: 'cdm.base.datetime', name: 'AdjustableDate', $type: 'data' },
        meta: { namespace: 'cdm.base.datetime', errors: [], hasExternalRefs: false }
      },
      {
        id: 'cdm.base.datetime.BusinessCenter',
        data: { namespace: 'cdm.base.datetime', name: 'BusinessCenter', $type: 'data' },
        meta: { namespace: 'cdm.base.datetime', errors: [], hasExternalRefs: false }
      },
      {
        id: 'cdm.base.datetime.BusinessCenterTime',
        data: { namespace: 'cdm.base.datetime', name: 'BusinessCenterTime', $type: 'data' },
        meta: { namespace: 'cdm.base.datetime', errors: [], hasExternalRefs: false }
      }
    ];
    editorStoreState.selectedNodeId = 'cdm.base.datetime.AdjustableDate';

    renderEditorPage({
      models: [],
      files: [
        {
          name: 'base-datetime-type.rosetta',
          path: 'base-datetime-type.rosetta',
          content: 'namespace cdm.base.datetime',
          dirty: false
        }
      ]
    });

    // A -> B via cross-reference navigation.
    act(() => {
      runeTypeGraphMockState.latestCallbacks?.onNavigateToType?.('cdm.base.datetime.BusinessCenter');
    });

    // Back to A — B is now on the forward stack.
    fireEvent.keyDown(screen.getByTestId('explore-workbench'), { key: 'ArrowLeft', altKey: true });
    expect(editorStoreState.selectedNodeId).toBe('cdm.base.datetime.AdjustableDate');

    // Mirrors deleteType(nodeId)'s exact real-store side effect: the
    // selected node A leaves `nodes` and selectedNodeId is cleared to null,
    // both in the same set().
    act(() => {
      useEditorStore.setState({
        nodes: [
          {
            id: 'cdm.base.datetime.BusinessCenter',
            data: { namespace: 'cdm.base.datetime', name: 'BusinessCenter', $type: 'data' },
            meta: { namespace: 'cdm.base.datetime', errors: [], hasExternalRefs: false }
          },
          {
            id: 'cdm.base.datetime.BusinessCenterTime',
            data: { namespace: 'cdm.base.datetime', name: 'BusinessCenterTime', $type: 'data' },
            meta: { namespace: 'cdm.base.datetime', errors: [], hasExternalRefs: false }
          }
        ],
        selectedNodeId: undefined
      });
    });
    expect(editorStoreState.selectedNodeId).toBeUndefined();

    // Select C via a non-history path — a genuine new visit, not a rekey.
    act(() => {
      editorStoreState.selectNode('cdm.base.datetime.BusinessCenterTime');
    });
    expect(editorStoreState.selectedNodeId).toBe('cdm.base.datetime.BusinessCenterTime');

    runeTypeGraphMockState.focusNode.mockClear();

    // Forward must now be a no-op — the stale B entry was invalidated by
    // the C selection, not silently resurrected.
    fireEvent.keyDown(screen.getByTestId('explore-workbench'), { key: 'ArrowRight', altKey: true });
    expect(editorStoreState.selectedNodeId).toBe('cdm.base.datetime.BusinessCenterTime');
    expect(runeTypeGraphMockState.focusNode).not.toHaveBeenCalled();
  });

  it('rewrites existing history entries when the selected node is renamed (old id may still be referenced elsewhere in history)', () => {
    // Regression: A -> B -> A -> rename(A -> A2) left the EARLIER 'A' entry
    // (pushed onto the back stack by the initial A -> B visit) under the
    // now-obsolete id — only the local `previous` tracking var got updated
    // to the new id, not pre-existing stack entries. A second Back (after
    // popping B) hit the dead 'A' id and showed a false "no longer in the
    // graph" toast instead of landing on the renamed node (A2).
    editorStoreState.nodes = [
      {
        id: 'cdm.base.datetime.AdjustableDate',
        data: { namespace: 'cdm.base.datetime', name: 'AdjustableDate', $type: 'data' },
        meta: { namespace: 'cdm.base.datetime', errors: [], hasExternalRefs: false }
      },
      {
        id: 'cdm.base.datetime.BusinessCenter',
        data: { namespace: 'cdm.base.datetime', name: 'BusinessCenter', $type: 'data' },
        meta: { namespace: 'cdm.base.datetime', errors: [], hasExternalRefs: false }
      }
    ];
    editorStoreState.selectedNodeId = 'cdm.base.datetime.AdjustableDate';

    renderEditorPage({
      models: [],
      files: [
        {
          name: 'base-datetime-type.rosetta',
          path: 'base-datetime-type.rosetta',
          content: 'namespace cdm.base.datetime',
          dirty: false
        }
      ]
    });

    // A -> B -> A, all real cross-reference navigations (not Back/Forward)
    // — the back stack now holds [A, B].
    act(() => {
      runeTypeGraphMockState.latestCallbacks?.onNavigateToType?.('cdm.base.datetime.BusinessCenter');
    });
    act(() => {
      runeTypeGraphMockState.latestCallbacks?.onNavigateToType?.('cdm.base.datetime.AdjustableDate');
    });
    expect(editorStoreState.selectedNodeId).toBe('cdm.base.datetime.AdjustableDate');

    // Mirrors renameType(nodeId, newName)'s exact real-store side effect:
    // the old id is removed from `nodes`, a new node is inserted under the
    // rekeyed id, and selectedNodeId is reassigned to it — all in the same
    // set().
    act(() => {
      useEditorStore.setState({
        nodes: [
          {
            id: 'cdm.base.datetime.AdjustableDateRenamed',
            data: { namespace: 'cdm.base.datetime', name: 'AdjustableDateRenamed', $type: 'data' },
            meta: { namespace: 'cdm.base.datetime', errors: [], hasExternalRefs: false }
          },
          {
            id: 'cdm.base.datetime.BusinessCenter',
            data: { namespace: 'cdm.base.datetime', name: 'BusinessCenter', $type: 'data' },
            meta: { namespace: 'cdm.base.datetime', errors: [], hasExternalRefs: false }
          }
        ],
        selectedNodeId: 'cdm.base.datetime.AdjustableDateRenamed'
      });
    });
    expect(editorStoreState.selectedNodeId).toBe('cdm.base.datetime.AdjustableDateRenamed');

    // First Back pops B.
    fireEvent.keyDown(screen.getByTestId('explore-workbench'), { key: 'ArrowLeft', altKey: true });
    expect(editorStoreState.selectedNodeId).toBe('cdm.base.datetime.BusinessCenter');
    expect(showToastSpy).not.toHaveBeenCalled();

    // Second Back must land on the RENAMED id, not error on the dead old one.
    fireEvent.keyDown(screen.getByTestId('explore-workbench'), { key: 'ArrowLeft', altKey: true });
    expect(showToastSpy).not.toHaveBeenCalled();
    expect(editorStoreState.selectedNodeId).toBe('cdm.base.datetime.AdjustableDateRenamed');
  });

  it('drops existing history entries for a node that is deleted (old id may still be referenced elsewhere in history)', () => {
    // Companion to the rename-rekey test above: deleteType has no new id to
    // rekey stale entries to, so matching entries must be dropped entirely
    // instead — a deleted id can never be navigated back to. A -> B -> A
    // leaves back=[A, B]; deleting the now-selected A must drop the stale
    // 'A' entry, leaving only the real B entry navigable.
    editorStoreState.nodes = [
      {
        id: 'cdm.base.datetime.AdjustableDate',
        data: { namespace: 'cdm.base.datetime', name: 'AdjustableDate', $type: 'data' },
        meta: { namespace: 'cdm.base.datetime', errors: [], hasExternalRefs: false }
      },
      {
        id: 'cdm.base.datetime.BusinessCenter',
        data: { namespace: 'cdm.base.datetime', name: 'BusinessCenter', $type: 'data' },
        meta: { namespace: 'cdm.base.datetime', errors: [], hasExternalRefs: false }
      }
    ];
    editorStoreState.selectedNodeId = 'cdm.base.datetime.AdjustableDate';

    renderEditorPage({
      models: [],
      files: [
        {
          name: 'base-datetime-type.rosetta',
          path: 'base-datetime-type.rosetta',
          content: 'namespace cdm.base.datetime',
          dirty: false
        }
      ]
    });

    // A -> B -> A, all real cross-reference navigations — back=[A, B].
    act(() => {
      runeTypeGraphMockState.latestCallbacks?.onNavigateToType?.('cdm.base.datetime.BusinessCenter');
    });
    act(() => {
      runeTypeGraphMockState.latestCallbacks?.onNavigateToType?.('cdm.base.datetime.AdjustableDate');
    });
    expect(editorStoreState.selectedNodeId).toBe('cdm.base.datetime.AdjustableDate');

    // Mirrors deleteType(nodeId)'s exact real-store side effect: the
    // selected node A leaves `nodes` and selectedNodeId is cleared to null,
    // both in the same set().
    act(() => {
      useEditorStore.setState({
        nodes: [
          {
            id: 'cdm.base.datetime.BusinessCenter',
            data: { namespace: 'cdm.base.datetime', name: 'BusinessCenter', $type: 'data' },
            meta: { namespace: 'cdm.base.datetime', errors: [], hasExternalRefs: false }
          }
        ],
        selectedNodeId: undefined
      });
    });
    expect(editorStoreState.selectedNodeId).toBeUndefined();

    // First Back pops the real B entry.
    fireEvent.keyDown(screen.getByTestId('explore-workbench'), { key: 'ArrowLeft', altKey: true });
    expect(editorStoreState.selectedNodeId).toBe('cdm.base.datetime.BusinessCenter');
    expect(showToastSpy).not.toHaveBeenCalled();

    // Second Back must be a silent no-op — the dead 'A' entry was dropped
    // at delete time, not left to trigger a "no longer in the graph" toast.
    fireEvent.keyDown(screen.getByTestId('explore-workbench'), { key: 'ArrowLeft', altKey: true });
    expect(showToastSpy).not.toHaveBeenCalled();
    expect(editorStoreState.selectedNodeId).toBe('cdm.base.datetime.BusinessCenter');
  });

  it('does not treat Ctrl+Alt+Left / Shift+Alt+Left as navigate-back (those are focus-prev-panel / reorder-tab-left)', () => {
    // Regression: the handler used to check `e.altKey` alone, so it also
    // fired navigateBack for these combos — which collide with real
    // shell/keyboard.ts bindings installed via a separate window-level
    // listener that this handler's preventDefault() doesn't stop.
    editorStoreState.nodes = [
      {
        id: 'cdm.base.datetime.AdjustableDate',
        data: { namespace: 'cdm.base.datetime', name: 'AdjustableDate', $type: 'data' },
        meta: { namespace: 'cdm.base.datetime', errors: [], hasExternalRefs: false }
      },
      {
        id: 'cdm.base.datetime.BusinessCenter',
        data: { namespace: 'cdm.base.datetime', name: 'BusinessCenter', $type: 'data' },
        meta: { namespace: 'cdm.base.datetime', errors: [], hasExternalRefs: false }
      }
    ];
    editorStoreState.selectedNodeId = 'cdm.base.datetime.AdjustableDate';

    renderEditorPage({
      models: [],
      files: [
        {
          name: 'base-datetime-type.rosetta',
          path: 'base-datetime-type.rosetta',
          content: 'namespace cdm.base.datetime',
          dirty: false
        }
      ]
    });

    act(() => {
      runeTypeGraphMockState.latestCallbacks?.onNavigateToType?.('cdm.base.datetime.BusinessCenter');
    });
    expect(editorStoreState.selectedNodeId).toBe('cdm.base.datetime.BusinessCenter');

    fireEvent.keyDown(screen.getByTestId('explore-workbench'), { key: 'ArrowLeft', altKey: true, ctrlKey: true });
    expect(editorStoreState.selectedNodeId).toBe('cdm.base.datetime.BusinessCenter');

    fireEvent.keyDown(screen.getByTestId('explore-workbench'), { key: 'ArrowLeft', altKey: true, shiftKey: true });
    expect(editorStoreState.selectedNodeId).toBe('cdm.base.datetime.BusinessCenter');

    // Plain Alt+Left still works.
    fireEvent.keyDown(screen.getByTestId('explore-workbench'), { key: 'ArrowLeft', altKey: true });
    expect(editorStoreState.selectedNodeId).toBe('cdm.base.datetime.AdjustableDate');
  });

  it('updates graph config direction when responsive relayout flips orientation', async () => {
    renderEditorPage({
      models: [],
      files: [
        {
          name: 'base-datetime-type.rosetta',
          path: 'base-datetime-type.rosetta',
          content: 'namespace cdm.base.datetime',
          dirty: false
        }
      ]
    });

    expect(runeTypeGraphMockState.latestConfig?.layout?.direction).toBe('LR');

    const graphCanvas = document.querySelector('.studio-graph-canvas') as HTMLDivElement | null;
    expect(graphCanvas).not.toBeNull();
    vi.spyOn(graphCanvas!, 'getBoundingClientRect').mockReturnValue({
      width: 800,
      height: 820
    } as DOMRect);

    fireEvent.click(screen.getByTitle('Re-run auto layout'));

    await waitFor(() => {
      expect(runeTypeGraphMockState.latestConfig?.layout?.direction).toBe('TB');
    });
  });

  it('updates graph config direction when the window resize makes the graph pane tall', async () => {
    renderEditorPage({
      models: [],
      files: [
        {
          name: 'base-datetime-type.rosetta',
          path: 'base-datetime-type.rosetta',
          content: 'namespace cdm.base.datetime',
          dirty: false
        }
      ]
    });

    expect(runeTypeGraphMockState.latestConfig?.layout?.direction).toBe('LR');

    const graphCanvas = document.querySelector('.studio-graph-canvas') as HTMLDivElement | null;
    expect(graphCanvas).not.toBeNull();
    vi.spyOn(graphCanvas!, 'getBoundingClientRect').mockReturnValue({
      width: 800,
      height: 820
    } as DOMRect);

    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    await waitFor(() => {
      expect(runeTypeGraphMockState.latestConfig?.layout?.direction).toBe('TB');
    });
  });

  it('reattaches the graph observer after a pane switch and defers relayout beyond its callback', () => {
    stubResizeObserver();
    resizeObserverMockState.instances = [];
    centerStackMockState.showGraph = false;
    const props = {
      models: [],
      files: [{ name: 'trade.rosetta', path: 'trade.rosetta', content: 'namespace test', dirty: false }]
    };
    renderEditorPage(props);
    expect(screen.getByTestId('center-stack-mock')).toBeInTheDocument();
    expect(centerStackMockState.setShowGraph).toBeDefined();
    expect(document.querySelector('.studio-graph-canvas')).toBeNull();

    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 1;
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    });
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      frames.delete(id);
    });
    try {
      centerStackMockState.showGraph = true;
      act(() => centerStackMockState.setShowGraph?.(true));
      const firstCanvas = document.querySelector('.studio-graph-canvas') as HTMLDivElement;
      expect(firstCanvas).not.toBeNull();
      const firstObserver = resizeObserverMockState.instances.find((instance) =>
        instance.targets.includes(firstCanvas)
      );
      expect(firstObserver).toBeDefined();

      // Flush the first mount's empty jsdom measurement before exercising a resize.
      act(() => {
        for (const [id, callback] of frames) {
          frames.delete(id);
          callback(0);
        }
      });
      vi.spyOn(firstCanvas, 'getBoundingClientRect').mockReturnValue({ width: 800, height: 820 } as DOMRect);
      runeTypeGraphMockState.relayout.mockClear();
      act(() => firstObserver?.callback([], {} as ResizeObserver));
      expect(runeTypeGraphMockState.relayout).not.toHaveBeenCalled();
      expect(frames.size).toBe(1);
      act(() => {
        const [id, callback] = [...frames][0]!;
        frames.delete(id);
        callback(0);
      });
      expect(runeTypeGraphMockState.relayout).toHaveBeenCalledWith({
        engine: 'dagre',
        direction: 'TB',
        groupByInheritance: false
      });

      act(() => centerStackMockState.setShowGraph?.(false));
      expect(firstObserver?.disconnected).toBe(true);
      act(() => centerStackMockState.setShowGraph?.(true));
      const secondCanvas = document.querySelector('.studio-graph-canvas') as HTMLDivElement;
      expect(secondCanvas).not.toBe(firstCanvas);
      expect(resizeObserverMockState.instances.some((instance) => instance.targets.includes(secondCanvas))).toBe(true);
    } finally {
      requestFrame.mockRestore();
      cancelFrame.mockRestore();
    }
  });

  it('fits the graph view when the graph pane resizes without changing orientation', async () => {
    renderEditorPage({
      models: [],
      files: [
        {
          name: 'base-datetime-type.rosetta',
          path: 'base-datetime-type.rosetta',
          content: 'namespace cdm.base.datetime',
          dirty: false
        }
      ]
    });

    const graphCanvas = document.querySelector('.studio-graph-canvas') as HTMLDivElement | null;
    expect(graphCanvas).not.toBeNull();
    vi.spyOn(graphCanvas!, 'getBoundingClientRect').mockReturnValue({
      width: 1100,
      height: 700
    } as DOMRect);

    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    await waitFor(() => {
      expect(runeTypeGraphMockState.fitView).toHaveBeenCalled();
    });
    expect(runeTypeGraphMockState.relayout).not.toHaveBeenCalled();
  });

  it('re-runs responsive relayout when a node becomes selected', async () => {
    const { rerenderEditorPage } = renderEditorPage({
      models: [],
      files: [
        {
          name: 'base-datetime-type.rosetta',
          path: 'base-datetime-type.rosetta',
          content: 'namespace cdm.base.datetime',
          dirty: false
        }
      ]
    });

    const graphCanvas = document.querySelector('.studio-graph-canvas') as HTMLDivElement | null;
    expect(graphCanvas).not.toBeNull();
    vi.spyOn(graphCanvas!, 'getBoundingClientRect').mockReturnValue({
      width: 800,
      height: 820
    } as DOMRect);

    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    await waitFor(() => {
      expect(runeTypeGraphMockState.latestConfig?.layout?.direction).toBe('TB');
    });

    runeTypeGraphMockState.relayout.mockClear();
    editorStoreState.nodes = [
      {
        id: 'cdm.base.datetime.BusinessCenter',
        data: { namespace: 'cdm.base.datetime', name: 'BusinessCenter', $type: 'data' },
        meta: { namespace: 'cdm.base.datetime', errors: [], hasExternalRefs: false }
      }
    ];
    editorStoreState.selectedNodeId = 'cdm.base.datetime.BusinessCenter';

    rerenderEditorPage({
      models: [],
      files: [
        {
          name: 'base-datetime-type.rosetta',
          path: 'base-datetime-type.rosetta',
          content: 'namespace cdm.base.datetime',
          dirty: false
        }
      ]
    });

    await waitFor(() => {
      expect(runeTypeGraphMockState.relayout).toHaveBeenCalledWith({
        engine: 'dagre',
        direction: 'TB',
        groupByInheritance: false
      });
    });
  });
});

// ---------------------------------------------------------------------------
// Regression guard: StructureView cell-editor wiring (Phase 5/8 integration)
// ---------------------------------------------------------------------------
// PR #190 review caught that NameCell, CardinalityCell, and TypePickerCell were
// built and unit-tested in isolation but never injected into the StructureView
// at the EditorPage mount site — same "shipped but unreachable" pattern as the
// Phase 7 integration miss fixed by PR #185.
//
// This suite asserts that EditorPage passes cellComponents containing the three
// cell constructors so DataNode's structure variant renders editable cells
// instead of read-only spans. It would have caught the original gap.
// ---------------------------------------------------------------------------
describe('EditorPage StructureView cell-editor wiring (Phase 5/8 regression guard)', () => {
  beforeEach(() => {
    vi.stubGlobal('Worker', MockWorker);
    stubResizeObserver();
    MockWorker.instances = [];
    setRuneStudioTestApi(() => undefined);
    usePreviewStore.getState().resetPreviewState();
    editorStoreState.nodes = [];
    editorStoreState.edges = [];
    editorStoreState.selectedNodeId = undefined;
    vi.clearAllMocks();
    structureViewMockState.latestProps = undefined;
    resizeObserverMockState.instances = [];
    centerStackMockState.showGraph = true;
    centerStackMockState.setShowGraph = undefined;
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

  it('passes cellComponents with NameCell, TypePickerCell, and CardinalityCell to StructureView', () => {
    // The CenterStackPanel mock (above) renders the structure pane unconditionally,
    // so StructureView renders immediately without needing to activate the pane.
    renderEditorPage({
      models: [],
      files: [
        {
          name: 'trade.rosetta',
          path: 'trade.rosetta',
          content: 'namespace alpha',
          dirty: false
        }
      ]
    });

    expect(screen.getByTestId('structure-view-mock')).toBeInTheDocument();

    const { cellComponents } = structureViewMockState.latestProps ?? {};
    expect(cellComponents).toBeDefined();
    // Assert identity against the sentinel functions exported by the mock —
    // if EditorPage is importing a different object (or undefined), these fail.
    expect(cellComponents?.name).toBe(structureViewMockState.SENTINEL_NAME_CELL);
    expect(cellComponents?.type).toBe(structureViewMockState.SENTINEL_TYPE_CELL);
    expect(cellComponents?.card).toBe(structureViewMockState.SENTINEL_CARD_CELL);
  });

  it('keeps hydrated curated models alive across same-workspace rerenders and clears them on workspace switch', async () => {
    vi.useFakeTimers();
    try {
      const hydratedModel = {
        name: 'cdm.base.datetime',
        elements: []
      } as unknown as import('@rune-langium/core').RosettaModel;
      const deferredEntry = {
        filePath: 'cdm/cdm.base.datetime',
        namespace: 'cdm.base.datetime',
        exports: [{ type: 'Data', name: 'BusinessCenters' }]
      };
      const workspaceService = await import('../../src/services/workspace.js');
      const linkDocumentMock = vi.mocked(workspaceService.linkDocument);
      linkDocumentMock.mockReset();
      linkDocumentMock.mockResolvedValueOnce({ linked: true, errors: [], newModels: [hydratedModel] });
      linkDocumentMock.mockResolvedValue({ linked: false, errors: [], newModels: [] });

      editorStoreState.nodes = [
        {
          id: 'cdm.base.datetime.BusinessCenters',
          data: {
            namespace: 'cdm.base.datetime',
            name: 'BusinessCenters',
            $type: 'Data',
            deferred: true
          },
          meta: { namespace: 'cdm.base.datetime', errors: [], hasExternalRefs: false, deferred: true }
        }
      ];
      editorStoreState.selectedNodeId = 'cdm.base.datetime.BusinessCenters';

      const { rerenderEditorPage } = renderEditorPage({
        workspaceId: 'ws-curated',
        models: [],
        deferredExports: [deferredEntry],
        files: [],
        fileCount: 0
      });

      expect(editorStoreState.loadModels).toHaveBeenCalledWith([]);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });

      expect(linkDocumentMock).toHaveBeenCalledWith('cdm/cdm.base.datetime');
      expect(editorStoreState.loadModels).toHaveBeenLastCalledWith([hydratedModel]);

      editorStoreState.loadModels.mockClear();

      await act(async () => {
        rerenderEditorPage({
          workspaceId: 'ws-curated',
          models: [],
          deferredExports: [deferredEntry],
          files: [],
          fileCount: 0
        });
      });

      expect(editorStoreState.loadModels).toHaveBeenLastCalledWith([hydratedModel]);

      editorStoreState.loadModels.mockClear();

      await act(async () => {
        rerenderEditorPage({
          workspaceId: 'ws-next',
          models: [],
          deferredExports: [deferredEntry],
          files: [],
          fileCount: 0
        });
      });

      expect(editorStoreState.loadModels).toHaveBeenLastCalledWith([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not re-link the selected curated node when only its object identity changes after hydration', async () => {
    vi.useFakeTimers();
    try {
      const deferredEntry = {
        filePath: 'cdm/cdm.base.staticdata.party',
        namespace: 'cdm.base.staticdata.party',
        exports: [{ type: 'Data', name: 'Counterparty' }]
      };
      const workspaceService = await import('../../src/services/workspace.js');
      const linkDocumentMock = vi.mocked(workspaceService.linkDocument);
      linkDocumentMock.mockReset();
      linkDocumentMock.mockResolvedValue({ linked: true, errors: [], newModels: [] });

      editorStoreState.nodes = [
        {
          id: 'cdm.base.staticdata.party.Counterparty',
          data: {
            namespace: 'cdm.base.staticdata.party',
            name: 'Counterparty',
            $type: 'Data',
            deferred: true
          },
          meta: { namespace: 'cdm.base.staticdata.party', errors: [], hasExternalRefs: false, deferred: true }
        }
      ];
      editorStoreState.selectedNodeId = 'cdm.base.staticdata.party.Counterparty';
      editorStoreState.hydrationNonce = 1;

      const { rerenderEditorPage } = renderEditorPage({
        workspaceId: 'ws-curated',
        models: [],
        deferredExports: [deferredEntry],
        files: [],
        fileCount: 0
      });

      await act(async () => {
        await Promise.resolve();
      });

      expect(linkDocumentMock).toHaveBeenCalledTimes(1);
      expect(linkDocumentMock).toHaveBeenLastCalledWith('cdm/cdm.base.staticdata.party');

      editorStoreState.nodes = [
        {
          id: 'cdm.base.staticdata.party.Counterparty',
          data: {
            namespace: 'cdm.base.staticdata.party',
            name: 'Counterparty',
            $type: 'Data',
            deferred: true
          },
          meta: { namespace: 'cdm.base.staticdata.party', errors: [], hasExternalRefs: false, deferred: true }
        }
      ];

      await act(async () => {
        rerenderEditorPage({
          workspaceId: 'ws-curated',
          models: [],
          deferredExports: [deferredEntry],
          files: [],
          fileCount: 0
        });
        await Promise.resolve();
      });

      expect(linkDocumentMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores stale curated link results that resolve after the workspace changes', async () => {
    vi.useFakeTimers();
    try {
      const hydratedModel = {
        name: 'cdm.base.datetime',
        elements: []
      } as unknown as import('@rune-langium/core').RosettaModel;
      const deferredEntry = {
        filePath: 'cdm/cdm.base.datetime',
        namespace: 'cdm.base.datetime',
        exports: [{ type: 'Data', name: 'BusinessCenters' }]
      };
      const workspaceService = await import('../../src/services/workspace.js');
      const linkDocumentMock = vi.mocked(workspaceService.linkDocument);
      linkDocumentMock.mockReset();

      let resolveLinkDocument:
        | ((value: { linked: boolean; errors: []; newModels: (typeof hydratedModel)[] }) => void)
        | undefined;
      linkDocumentMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveLinkDocument = resolve;
          })
      );
      linkDocumentMock.mockResolvedValue({ linked: false, errors: [], newModels: [] });

      editorStoreState.nodes = [
        {
          id: 'cdm.base.datetime.BusinessCenters',
          data: {
            namespace: 'cdm.base.datetime',
            name: 'BusinessCenters',
            $type: 'Data',
            deferred: true
          },
          meta: { namespace: 'cdm.base.datetime', errors: [], hasExternalRefs: false, deferred: true }
        }
      ];
      editorStoreState.selectedNodeId = 'cdm.base.datetime.BusinessCenters';

      const { rerenderEditorPage } = renderEditorPage({
        workspaceId: 'ws-curated',
        models: [],
        deferredExports: [deferredEntry],
        files: [],
        fileCount: 0
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });

      expect(linkDocumentMock).toHaveBeenCalledWith('cdm/cdm.base.datetime');

      editorStoreState.nodes = [];
      editorStoreState.selectedNodeId = undefined;
      editorStoreState.loadModels.mockClear();

      await act(async () => {
        rerenderEditorPage({
          workspaceId: 'ws-next',
          models: [],
          deferredExports: [deferredEntry],
          files: [],
          fileCount: 0
        });
      });

      expect(editorStoreState.loadModels).toHaveBeenLastCalledWith([]);
      const callCountAfterWorkspaceSwitch = editorStoreState.loadModels.mock.calls.length;

      resolveLinkDocument?.({ linked: true, errors: [], newModels: [hydratedModel] });

      await act(async () => {
        await Promise.resolve();
      });

      expect(editorStoreState.loadModels.mock.calls).toHaveLength(callCountAfterWorkspaceSwitch);
      expect(editorStoreState.loadModels).toHaveBeenLastCalledWith([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('EditorPage source reveal lifecycle', () => {
  const namespace = 'cdm.base.datetime';
  const path = 'cdm/datetime.rosetta';
  const content = 'namespace cdm.base.datetime\n\ntype BusinessCentersExtra:\n\ntype BusinessCenters:\n\ntype Other:\n';
  let frames: FrameRequestCallback[];

  function flushFrames() {
    const queued = frames.splice(0);
    act(() => queued.forEach((callback) => callback(0)));
  }

  function select(name = 'BusinessCenters', coordinates = {}, kind = 'Data') {
    const node = {
      id: `${namespace}.${name}#${kind}`,
      data: { name, $type: kind, ...coordinates },
      meta: { namespace, errors: [], hasExternalRefs: false }
    };
    editorStoreState.nodes = [node];
    editorStoreState.selectedNodeId = node.id;
  }

  function props(source = content) {
    return {
      workspaceId: 'workspace-a',
      files: [
        {
          name: 'datetime.rosetta',
          path,
          content: source,
          dirty: false,
          readOnly: true,
          refOnly: true,
          namespace,
          artifactKey: 'cdm/content-digest/datetime'
        }
      ],
      deferredExports: [
        {
          namespace,
          filePath: path,
          exports: [
            { name: 'BusinessCenters', type: 'Data' },
            { name: 'Other', type: 'Data' }
          ]
        }
      ]
    };
  }

  beforeEach(() => {
    vi.stubGlobal('Worker', MockWorker);
    stubResizeObserver();
    frames = [];
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      })
    );
    MockWorker.instances = [];
    usePreviewStore.getState().resetPreviewState();
    usePerspectiveStore.setState({ activePerspective: 'explore' });
    useExploreFileNavStore.setState({ activeEditorFile: undefined, requestedSourceFile: undefined, syncStatus: null });
    editorStoreState.nodes = [];
    editorStoreState.selectedNodeId = undefined;
    editorStoreState.hydratedNamespaces = [];
    editorStoreState.pendingHydrationNamespaces = [];
    vi.clearAllMocks();
    sourceEditorMockState.revealLine.mockReturnValue(true);
    sourceEditorMockState.showSource = true;
    centerStackMockState.showGraph = true;
  });

  afterEach(() => {
    cleanup();
    sourceEditorMockState.showSource = true;
    vi.unstubAllGlobals();
  });

  it.each(['basicType', 'recordType'])('finds a coordinate-less %s declaration by exact name', (keyword) => {
    const kind = keyword === 'basicType' ? 'RosettaBasicType' : 'RosettaRecordType';
    select('BusinessCenters', {}, kind);
    const source = `namespace ${namespace}\n${keyword} BusinessCentersExtra\n\n${keyword} ^BusinessCenters\n`;
    const input = props(source);
    input.deferredExports[0]!.exports[0]!.type = kind;
    renderEditorPage(input);
    flushFrames();
    expect(sourceEditorMockState.revealLine).toHaveBeenCalledExactlyOnceWith(4, path);
  });

  function editableProps(source: string, snapshot?: string) {
    const input = props(source);
    const model = {
      $type: 'RosettaModel',
      name: namespace,
      imports: [],
      elements: []
    } as unknown as import('@rune-langium/core').RosettaModel;
    return {
      ...input,
      files: input.files.map((file) => ({ ...file, readOnly: false, refOnly: false })),
      parsedModels: [{ filePath: path, model, source: snapshot }]
    };
  }

  it.each(['$cstRange', '$cstNode', '$textRegion'])(
    'ignores stale %s offsets after edits before parsing finishes',
    (key) => {
      const edited = `// inserted line\n// another line\n${content}`;
      select('BusinessCenters', { [key]: { offset: content.indexOf('type BusinessCenters:'), end: content.length } });
      renderEditorPage(editableProps(edited, content));
      flushFrames();
      expect(sourceEditorMockState.revealLine).toHaveBeenCalledExactlyOnceWith(7, path);
    }
  );

  it('does not trust editable coordinates without a parsed source snapshot', () => {
    const source = 'namespace cdm.base.datetime\n\ntype\n  BusinessCenters:\n';
    select('BusinessCenters', { $cstRange: { offset: source.indexOf('type'), end: source.length } });
    renderEditorPage(editableProps(source));
    flushFrames();
    expect(sourceEditorMockState.revealLine).not.toHaveBeenCalled();
  });

  it('does not trust deferred coordinates without a curated artifact identity', () => {
    const source = 'namespace cdm.base.datetime\n\ntype\n  BusinessCenters:\n';
    select('BusinessCenters', { $cstRange: { offset: source.indexOf('type'), end: source.length } });
    const input = props(source);
    renderEditorPage({ ...input, files: input.files.map((file) => ({ ...file, artifactKey: undefined })) });
    flushFrames();
    expect(sourceEditorMockState.revealLine).not.toHaveBeenCalled();
  });

  it('keeps an ambiguous reveal pending until its parsed source snapshot becomes current', () => {
    const snapshot = 'namespace cdm.base.datetime\nfunc BusinessCenters:\n\ntype BusinessCenters:\n';
    const source = `// edit\n${snapshot}`;
    select('BusinessCenters', { $cstRange: { offset: source.indexOf('type BusinessCenters:'), end: source.length } });
    const input = editableProps(source, snapshot);
    const view = renderEditorPage(input);
    flushFrames();
    expect(sourceEditorMockState.revealLine).not.toHaveBeenCalled();
    view.rerenderEditorPage({ ...input, parsedModels: [{ ...input.parsedModels[0]!, source }] });
    flushFrames();
    expect(sourceEditorMockState.revealLine).toHaveBeenCalledExactlyOnceWith(5, path);
  });

  it('ignores declaration-looking lines inside comments and strings', () => {
    const source =
      'namespace cdm.base.datetime\n/*\ntype BusinessCenters:\n*/\n<"\ntype BusinessCenters:\n">\ntype BusinessCenters:\n';
    select();
    renderEditorPage(props(source));
    flushFrames();
    expect(sourceEditorMockState.revealLine).toHaveBeenCalledExactlyOnceWith(8, path);
  });

  it('waits for AST coordinates when different declaration kinds share a name', () => {
    const source = 'namespace cdm.base.datetime\nfunc BusinessCenters:\n\ntype BusinessCenters:\n';
    select();
    const input = props(source);
    const view = renderEditorPage(input);
    flushFrames();
    expect(sourceEditorMockState.revealLine).not.toHaveBeenCalled();
    select('BusinessCenters', { $cstRange: { offset: source.indexOf('type BusinessCenters:'), end: source.length } });
    view.rerenderEditorPage(input);
    flushFrames();
    expect(sourceEditorMockState.revealLine).toHaveBeenCalledExactlyOnceWith(4, path);
  });

  it('uses exact declaration identity when Source is already mounted', () => {
    const input = props();
    const view = renderEditorPage(input);
    select();
    view.rerenderEditorPage(input);
    flushFrames();
    expect(sourceEditorMockState.revealLine).toHaveBeenCalledExactlyOnceWith(5, path);
  });

  it('waits for source even when hydrated AST coordinates arrive first', () => {
    select('BusinessCenters', { $cstRange: { offset: content.indexOf('type BusinessCenters:'), end: content.length } });
    const view = renderEditorPage(props(''));
    flushFrames();
    expect(sourceEditorMockState.revealLine).not.toHaveBeenCalled();
    view.rerenderEditorPage(props());
    flushFrames();
    expect(sourceEditorMockState.revealLine).toHaveBeenCalledExactlyOnceWith(5, path);
  });

  it('retries when AST coordinates arrive after source without reopening a tab', () => {
    // A multiline declaration cannot be located by the single-line fallback.
    const source = 'namespace cdm.base.datetime\n\ntype\n  BusinessCenters:\n';
    select();
    const input = props(source);
    const view = renderEditorPage(input);
    flushFrames();
    expect(sourceEditorMockState.revealLine).not.toHaveBeenCalled();
    select('BusinessCenters', { $cstRange: { offset: source.indexOf('type'), end: source.length } });
    view.rerenderEditorPage(input);
    flushFrames();
    expect(sourceEditorMockState.revealLine).toHaveBeenCalledExactlyOnceWith(3, path);
  });

  it.each(['$cstNode', '$textRegion'])('uses %s offsets for hydrated declarations', (key) => {
    select('BusinessCenters', { [key]: { offset: content.indexOf('type BusinessCenters:'), end: content.length } });
    renderEditorPage(props());
    flushFrames();
    expect(sourceEditorMockState.revealLine).toHaveBeenCalledExactlyOnceWith(5, path);
  });

  it('exposes reactive navigation feedback only until a matching view acknowledges arrival', () => {
    select();
    sourceEditorMockState.revealLine.mockReturnValue(false);
    renderEditorPage(props());
    flushFrames();
    expect(screen.getByTestId('center-stack-mock')).toHaveAttribute('data-source-pending', 'true');
    sourceEditorMockState.revealLine.mockReturnValue(true);
    act(() => sourceEditorMockState.latestProps?.onEditorViewCreated?.(path, { id: path }));
    flushFrames();
    expect(screen.getByTestId('center-stack-mock')).toHaveAttribute('data-source-pending', 'false');
  });

  it('does not replay an Inspector arrival when the selected declaration is edited', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      select();
      const input = props();
      const view = renderEditorPage(input);
      act(() => namespaceExplorerMockState.latestProps?.onSelectNode?.(editorStoreState.selectedNodeId!));
      flushFrames();
      flushFrames();
      expect(view.container.querySelector('.studio-scroll.navigation-arrival')).not.toBeNull();
      act(() => vi.advanceTimersByTime(1000));
      editorStoreState.nodes = editorStoreState.nodes.map((node) => ({ ...node, data: { ...node.data } }));
      view.rerenderEditorPage(input);
      flushFrames();
      flushFrames();
      expect(view.container.querySelector('.studio-scroll.navigation-arrival')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores an old same-path source failure while a newer workspace load remains pending', async () => {
    select();
    let rejectOld: (error: Error) => void = () => {};
    let resolveNew: () => void = () => {};
    const loadCuratedSource = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectOld = reject;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveNew = resolve;
          })
      );
    const input = { ...props(''), loadCuratedSource };
    Object.assign(input.files[0]!, { bundleId: 'cdm', bundleVersion: 'latest' });
    const view = renderEditorPage(input);
    view.rerenderEditorPage({ ...input, workspaceId: 'workspace-b' });
    expect(loadCuratedSource).toHaveBeenCalledTimes(2);
    await act(async () => {
      rejectOld(new Error('old request'));
    });
    expect(screen.getByTestId('center-stack-mock')).toHaveAttribute('data-source-pending', 'true');
    expect(screen.queryByText('Source unavailable: old request')).toBeNull();
    await act(async () => {
      resolveNew();
    });
    expect(screen.getByTestId('center-stack-mock')).toHaveAttribute('data-source-pending', 'false');
  });

  it('cancels a queued declaration reveal when file-only navigation targets that same file', () => {
    select();
    renderEditorPage(props());
    act(() => useExploreFileNavStore.getState().requestSourceFile(path));
    flushFrames();
    expect(sourceEditorMockState.revealLine).not.toHaveBeenCalled();
  });

  it('cues the destination pane for a loaded cross-file search jump', () => {
    const input = props();
    input.files.push({ ...input.files[0]!, name: 'other.rosetta', path: 'other.rosetta', content: 'namespace other' });
    renderEditorPage(input);
    act(() => useExploreFileNavStore.getState().requestSourceFile('other.rosetta'));
    expect(screen.getByLabelText('Source file path').parentElement).toHaveClass('navigation-arrival');
    expect(sourceEditorMockState.latestProps?.activeFile).toBe('other.rosetta');
    expect(sourceEditorMockState.revealLine).not.toHaveBeenCalled();
  });

  it('cues the loaded Source pane for file-only search without inventing a line', () => {
    const input = props();
    renderEditorPage(input);
    act(() => useExploreFileNavStore.getState().requestSourceFile(path));
    expect(screen.getByLabelText('Source file path').parentElement).toHaveClass('navigation-arrival');
    expect(sourceEditorMockState.revealLine).not.toHaveBeenCalled();
  });

  it('does not report an unavailable source placeholder as actively locating', () => {
    select();
    renderEditorPage(props(''));
    flushFrames();
    expect(screen.getByTestId('center-stack-mock')).toHaveAttribute('data-source-pending', 'false');
  });

  it('stops feedback when a ready source cannot resolve the destination', () => {
    select('Missing');
    renderEditorPage(props());
    flushFrames();
    expect(screen.getByTestId('center-stack-mock')).toHaveAttribute('data-source-pending', 'false');
  });

  it('syncs a Source-origin selection to other panes without scrolling or cueing Source itself', () => {
    select();
    const other = {
      id: `${namespace}.Other#Data`,
      data: { name: 'Other', $type: 'Data' },
      meta: { namespace, errors: [], hasExternalRefs: false }
    };
    editorStoreState.nodes.push(other);
    renderEditorPage(props());
    sourceEditorMockState.clearRevealHighlight.mockClear();
    // A direct source click supersedes even a still-queued external reveal.
    act(() => sourceEditorMockState.latestProps?.onNavigateToNode?.(other.id));
    flushFrames();
    flushFrames();
    expect(editorStoreState.selectedNodeId).toBe(other.id);
    expect(structureViewMockState.latestProps?.navigationRevision).toBe(1);
    expect(sourceEditorMockState.clearRevealHighlight).not.toHaveBeenCalled();
    expect(usePreviewStore.getState().selectedTarget?.id).toBe(other.id);
    expect(sourceEditorMockState.revealLine).not.toHaveBeenCalled();
    expect(screen.getByTestId('center-stack-mock')).toHaveAttribute('data-source-pending', 'false');

    // A later indirect request to that same target must still reveal Source.
    act(() => runeTypeGraphMockState.latestCallbacks?.onNavigateToType?.(other.id));
    flushFrames();
    expect(sourceEditorMockState.revealLine).toHaveBeenCalledWith(7, path);
  });

  it('can restore a Source-origin selection when Source actually remounts', () => {
    select();
    const input = props();
    const view = renderEditorPage(input);
    act(() => sourceEditorMockState.latestProps?.onNavigateToNode?.(editorStoreState.selectedNodeId!));
    flushFrames();
    expect(sourceEditorMockState.revealLine).not.toHaveBeenCalled();
    sourceEditorMockState.showSource = false;
    view.rerenderEditorPage(input);
    sourceEditorMockState.showSource = true;
    view.rerenderEditorPage(input);
    flushFrames();
    expect(sourceEditorMockState.revealLine).toHaveBeenCalledWith(5, path);
  });

  it('restarts a fully loaded source arrival for repeated indirect navigation to the same type', () => {
    select();
    renderEditorPage(props());
    flushFrames();
    sourceEditorMockState.revealLine.mockClear();
    act(() => namespaceExplorerMockState.latestProps?.onSelectNode?.(editorStoreState.selectedNodeId!));
    flushFrames();
    expect(sourceEditorMockState.revealLine).toHaveBeenCalledWith(5, path);
    expect(structureViewMockState.latestProps?.navigationRevision).toBe(1);
    const firstPreviewRequest = usePreviewStore.getState().navigationRequest;
    expect(firstPreviewRequest?.targetId).toBe(editorStoreState.selectedNodeId);
    act(() => namespaceExplorerMockState.latestProps?.onSelectNode?.(editorStoreState.selectedNodeId!));
    expect(structureViewMockState.latestProps?.navigationRevision).toBe(2);
    expect(usePreviewStore.getState().navigationRequest?.revision).toBe(firstPreviewRequest!.revision + 1);
  });

  it('retains an unacknowledged reveal until the matching view is ready', () => {
    select();
    sourceEditorMockState.revealLine.mockReturnValue(false);
    renderEditorPage(props());
    flushFrames();
    expect(sourceEditorMockState.revealLine).toHaveBeenCalledWith(5, path);
    sourceEditorMockState.revealLine.mockClear().mockReturnValue(true);
    act(() => sourceEditorMockState.latestProps?.onEditorViewCreated?.(path, { id: path }));
    flushFrames();
    expect(sourceEditorMockState.revealLine).toHaveBeenCalledExactlyOnceWith(5, path);
  });

  it('keeps a hidden-pane reveal and restores the selection after reopening Source', () => {
    select();
    sourceEditorMockState.showSource = false;
    const input = props();
    const view = renderEditorPage(input);
    flushFrames();
    expect(sourceEditorMockState.revealLine).not.toHaveBeenCalled();
    sourceEditorMockState.showSource = true;
    view.rerenderEditorPage({ ...input });
    flushFrames();
    expect(sourceEditorMockState.revealLine).toHaveBeenCalledExactlyOnceWith(5, path);
    sourceEditorMockState.showSource = false;
    view.rerenderEditorPage({ ...input });
    sourceEditorMockState.showSource = true;
    view.rerenderEditorPage({ ...input });
    flushFrames();
    expect(sourceEditorMockState.revealLine).toHaveBeenCalledTimes(2);
    expect(sourceEditorMockState.revealLine).toHaveBeenLastCalledWith(5, path);
  });

  it('discards a scheduled reveal after a rapid A to B selection', () => {
    select();
    const input = props();
    const view = renderEditorPage(input);
    select('Other');
    view.rerenderEditorPage(input);
    flushFrames();
    expect(sourceEditorMockState.revealLine).toHaveBeenCalledExactlyOnceWith(7, path);
  });

  it('discards a scheduled reveal when the workspace changes', () => {
    select();
    const view = renderEditorPage(props());
    editorStoreState.selectedNodeId = undefined;
    editorStoreState.nodes = [];
    view.rerenderEditorPage({ workspaceId: 'workspace-b', files: [], deferredExports: [] });
    flushFrames();
    expect(sourceEditorMockState.revealLine).not.toHaveBeenCalled();
  });

  it('follows a selected declaration when hydration replaces its deferred file path', () => {
    select();
    const input = props('');
    const other = { name: 'user.rosetta', path: 'user.rosetta', content: 'namespace user', dirty: false };
    input.files.push(other as (typeof input.files)[number]);
    const view = renderEditorPage(input);
    const hydrated = props();
    hydrated.files[0]!.path = 'cdm/hydrated-datetime.rosetta';
    hydrated.deferredExports[0]!.filePath = hydrated.files[0]!.path;
    hydrated.files.push(other as (typeof hydrated.files)[number]);
    view.rerenderEditorPage(hydrated);
    flushFrames();
    expect(useExploreFileNavStore.getState().activeEditorFile).toBe(hydrated.files[0]!.path);
    expect(sourceEditorMockState.revealLine).toHaveBeenCalledExactlyOnceWith(5, hydrated.files[0]!.path);
  });

  it('does not reopen a canceled selection when hydration changes its file path', () => {
    select();
    const input = props('');
    const other = { name: 'user.rosetta', path: 'user.rosetta', content: 'namespace user', dirty: false };
    input.files.push(other as (typeof input.files)[number]);
    const view = renderEditorPage(input);
    act(() => useExploreFileNavStore.getState().setActiveEditorFile('user.rosetta'));
    const hydrated = props();
    hydrated.files.push(other as (typeof hydrated.files)[number]);
    hydrated.files[0]!.path = 'cdm/hydrated-datetime.rosetta';
    hydrated.deferredExports[0]!.filePath = hydrated.files[0]!.path;
    view.rerenderEditorPage(hydrated);
    flushFrames();
    expect(useExploreFileNavStore.getState().activeEditorFile).toBe('user.rosetta');
    expect(sourceEditorMockState.revealLine).not.toHaveBeenCalled();
  });

  it('does not override explicit tab navigation when source or AST arrives later', () => {
    select();
    const other = { name: 'user.rosetta', path: 'user.rosetta', content: 'namespace user', dirty: false };
    const input = props('');
    input.files.push(other as (typeof input.files)[number]);
    const view = renderEditorPage(input);
    act(() => useExploreFileNavStore.getState().setActiveEditorFile(other.path));
    select('BusinessCenters', { $cstRange: { offset: content.indexOf('type BusinessCenters:'), end: content.length } });
    view.rerenderEditorPage({ ...props(), files: [...props().files, other as (typeof input.files)[number]] });
    flushFrames();
    expect(useExploreFileNavStore.getState().activeEditorFile).toBe(other.path);
    expect(sourceEditorMockState.revealLine).not.toHaveBeenCalled();
  });
});
