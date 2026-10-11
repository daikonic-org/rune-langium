// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * Integration regression guard: inspector/structure edits sync to source
 * WITHOUT the Graph pane mounted.
 *
 * Defect B (2026-05-21, fix/inspector-source-sync): the source-sync
 * subscription lived inside `RuneTypeGraph`, which is only mounted when
 * the Graph pane is the active visual pane.  Edits made while the
 * Structure pane was active never reached `onFilesChange`.
 *
 * Fix: `useModelSourceSync` was lifted to `EditorPage` and called
 * unconditionally (line ~1173 of EditorPage.tsx), so the subscription
 * fires regardless of which visual pane is mounted.
 *
 * This test proves the integration-site wiring:
 *   1. `EditorPage` is rendered with a real parsed model.
 *   2. `CenterStackPanel` is stubbed to call only `renderStructure` (not
 *      `renderGraph`) — the Graph pane is intentionally absent.
 *   3. A store mutation (`updateCardinality`) replicates what the
 *      Structure-pane cell editors do.
 *   4. `onFilesChange` is asserted to fire with a file whose content
 *      reflects the edit.
 *
 * If the fix regresses (hook moved back inside RuneTypeGraph, or the
 * call removed from EditorPage), the store mutation will not trigger
 * `onFilesChange` and the `waitFor` will time out — exactly the
 * behaviour the fix eliminated.
 */

import React, { useImperativeHandle } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, waitFor, act, screen } from '@testing-library/react';
import { parse } from '@rune-langium/core';
import { setRuneStudioTestApi } from '../../src/test-api.js';
import { SourceNavigationFeedbackContext } from '../../src/shell/source-navigation-feedback-context.js';
import { usePreviewStore } from '../../src/store/preview-store.js';
import { usePerspectiveStore } from '../../src/store/perspective-store.js';

// ---------------------------------------------------------------------------
// Hoisted shared state
// ---------------------------------------------------------------------------

const { showToastSpy, sourceState, inspectorState } = vi.hoisted(() => ({
  showToastSpy: vi.fn(),
  sourceState: { revealLine: vi.fn(() => true), show: true },
  inspectorState: { actions: undefined as { renameType: (nodeId: string, name: string) => void } | undefined }
}));

// ---------------------------------------------------------------------------
// Worker stub (matches existing harness)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// @rune-langium/visual-editor mock
//
// The critical difference from other EditorPage test files:
//
//   useModelSourceSync — we use vi.importActual to get the REAL implementation.
//   useEditorStore     — we use vi.importActual to get the REAL Zustand store
//                        so React components re-render on state changes and
//                        updateCardinality()/etc. work correctly.
//
// All visual components (RuneTypeGraph, StructureView, …) remain stubbed so
// the test stays fast and focused on the sync wiring, not graph rendering.
// ---------------------------------------------------------------------------

vi.mock('@rune-langium/visual-editor', async () => {
  const actual = await vi.importActual<typeof import('@rune-langium/visual-editor')>('@rune-langium/visual-editor');
  return {
    ...actual,
    // Render stubs — keep the test fast; none of these affect the sync path.
    RuneTypeGraph: React.forwardRef((_props: unknown, ref: React.ForwardedRef<unknown>) => {
      useImperativeHandle(ref, () => ({
        fitView: () => {},
        focusNode: () => {},
        relayout: () => {},
        exportRosetta: () => new Map()
      }));
      return React.createElement('div', { 'data-testid': 'graph-mock' });
    }),
    NamespaceExplorerPanel: () => React.createElement('div'),
    StructureView: () => React.createElement('div', { 'data-testid': 'structure-view-mock' }),
    EditorFormPanel: (props: { actions: { renameType: (nodeId: string, name: string) => void } }) => {
      inspectorState.actions = props.actions;
      return React.createElement('div');
    },
    ExpressionBuilder: () => React.createElement('div'),
    NameCell: () => null,
    CardinalityCell: () => null,
    TypePickerCell: () => null
    // useModelSourceSync and useEditorStore come from `actual` (the spread above).
    // All other non-component exports also come from actual, so BUILTIN_TYPES,
    // AST_TYPE_TO_NODE_TYPE, resolveNodeKind, etc. work correctly too.
  };
});

// ---------------------------------------------------------------------------
// Remaining heavy dependencies — same stubs as other EditorPage tests
// ---------------------------------------------------------------------------

vi.mock('../../src/components/SourceEditor.js', () => ({
  SourceEditor: React.forwardRef(
    (
      props: { activeFile?: string; onEditorViewCreated?: (path: string, view: object) => void },
      ref: React.ForwardedRef<unknown>
    ) => {
      useImperativeHandle(ref, () => ({ revealLine: sourceState.revealLine, revealPosition: () => {} }));
      React.useEffect(() => {
        if (props.activeFile) props.onEditorViewCreated?.(props.activeFile, {});
      }, [props.activeFile, props.onEditorViewCreated]);
      return React.createElement('div', { 'data-testid': 'source-editor-mock' });
    }
  )
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

vi.mock('../../src/shell/DockShell.js', () => {
  const PanelBody = ({ render }: { render: () => React.ReactElement | null }) => render();
  return {
    DockShell: ({ panelComponents }: { panelComponents?: Record<string, () => React.ReactElement | null> }) =>
      React.createElement(
        'div',
        { 'data-testid': 'dock-shell' },
        panelComponents?.['workspace.visualPreview']
          ? React.createElement(PanelBody, { render: panelComponents['workspace.visualPreview'] })
          : null
      )
  };
});

/**
 * CenterStackPanel stub that renders ONLY the Structure pane and NEVER
 * the Graph pane — this is the key regression probe.  Before the fix,
 * the source-sync subscription only fired when renderGraph() was called
 * (i.e., RuneTypeGraph was mounted).  With the fix, the subscription
 * lives in EditorPage itself and fires unconditionally.
 */
vi.mock('../../src/shell/panels/CenterStackPanel.js', () => ({
  CenterStackPanel: ({
    renderStructure,
    renderSource,
    renderInspector
  }: {
    renderGraph?: () => React.ReactElement | null;
    renderSource?: () => React.ReactElement | null;
    renderInspector?: () => React.ReactElement | null;
    renderStructure?: () => React.ReactElement | null;
  }) => {
    const pending = React.useContext(SourceNavigationFeedbackContext);
    return React.createElement(
      'div',
      { 'data-testid': 'center-stack-no-graph', 'data-source-pending': Boolean(pending) },
      // Deliberately skip renderGraph() — that's the whole point of this test.
      sourceState.show ? (renderSource?.() ?? null) : null,
      renderInspector?.() ?? null,
      renderStructure?.() ?? null
    );
  }
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

vi.mock('../../src/components/StudioToastProvider.js', () => ({
  StudioToastProvider: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, {}, children),
  useStudioToast: () => ({ showToast: showToastSpy, showLoadingToast: vi.fn(() => 'toast-id'), dismissToast: vi.fn() })
}));

vi.mock('../../src/utils/uri.js', () => ({
  pathToUri: (path: string) => `file://${path}`
}));

// ---------------------------------------------------------------------------
// Import after mocks are set up
// ---------------------------------------------------------------------------

import { renderEditorPage } from './editor-page-harness.js';
import { useEditorStore } from '@rune-langium/visual-editor';

// ---------------------------------------------------------------------------
// Rosetta source fixture
// ---------------------------------------------------------------------------

const NS = 'sync.test';
const FILE_PATH = 'sync-test.rosetta';

const ROSETTA_SOURCE = `namespace ${NS}
version "1.0.0"

type Order:
  quantity int (1..1)
  price number (1..1)
`;

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('EditorPage — Structure-mode source sync (regression fix/inspector-source-sync)', () => {
  beforeEach(() => {
    vi.stubGlobal('Worker', MockWorker);
    MockWorker.instances = [];
    setRuneStudioTestApi(() => undefined);
    vi.clearAllMocks();
    sourceState.show = true;
    usePreviewStore.getState().resetPreviewState();
    // Reset the real Zustand editor store between tests so nodes from a
    // previous run don't bleed in and confuse the fingerprint / initial-skip.
    act(() => {
      useEditorStore.getState().loadModels([]);
    });
    // EditorPage embeds PerspectiveHost; store defaults to 'workspaces' which
    // renders WorkspacesPerspective (requires context). This test renders a
    // loaded workspace — reset to 'explore' so DockShell is shown.
    usePerspectiveStore.setState({ activePerspective: 'explore' });
  });

  afterEach(() => {
    setRuneStudioTestApi(() => undefined);
    vi.unstubAllGlobals();
    cleanup();
  });

  it.each(['inspector', 'structure'])(
    'does not navigate after an actual %s rename, but follows the renamed selection',
    async (origin) => {
      const model = (await parse(ROSETTA_SOURCE, `inmemory:///${FILE_PATH}`)).value;
      const onFilesChange = vi.fn();
      const input = {
        models: [model],
        parsedModels: [{ filePath: FILE_PATH, model, source: ROSETTA_SOURCE }],
        files: [{ name: FILE_PATH, path: FILE_PATH, content: ROSETTA_SOURCE, dirty: false }],
        onFilesChange
      };
      const view = renderEditorPage(input);
      const node = useEditorStore.getState().nodes.find((entry) => entry.data.name === 'Order')!;
      act(() => useEditorStore.getState().selectNode(node.id));
      await waitFor(() => expect(sourceState.revealLine).toHaveBeenCalled());
      sourceState.revealLine.mockClear();
      onFilesChange.mockClear();
      act(() => {
        if (origin === 'inspector') inspectorState.actions!.renameType(node.id, 'Renamed');
        else useEditorStore.getState().renameType(node.id, 'Renamed');
      });
      const renamed = useEditorStore.getState().selectedNodeId!;
      expect(renamed).not.toBe(node.id);
      expect(usePreviewStore.getState().selectedTargetId).toBe(renamed);
      expect(usePreviewStore.getState().navigationRequest).toBeUndefined();
      expect(screen.getByTestId('center-stack-no-graph')).toHaveAttribute('data-source-pending', 'false');
      await waitFor(() => expect(onFilesChange).toHaveBeenCalled());
      const updatedFiles = onFilesChange.mock.calls.at(-1)![0];
      const updatedModel = (await parse(updatedFiles[0].content, `inmemory:///${FILE_PATH}`)).value;
      const nextInput = {
        ...input,
        files: updatedFiles,
        models: [updatedModel],
        parsedModels: [{ filePath: FILE_PATH, model: updatedModel, source: updatedFiles[0].content }]
      };
      view.rerenderEditorPage(nextInput);
      await act(async () => {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      });
      expect(sourceState.revealLine).not.toHaveBeenCalled();
      expect(usePreviewStore.getState().navigationRequest).toBeUndefined();
      // A real pane reopen still restores the renamed destination.
      sourceState.show = false;
      view.rerenderEditorPage(nextInput);
      sourceState.show = true;
      view.rerenderEditorPage(nextInput);
      await waitFor(() => expect(sourceState.revealLine).toHaveBeenCalled());
      sourceState.revealLine.mockClear();
      // A genuine same-target selection after the edit is a new navigation.
      act(() => useEditorStore.getState().selectNode(renamed));
      await waitFor(() => expect(sourceState.revealLine).toHaveBeenCalled());
      expect(usePreviewStore.getState().navigationRequest?.targetId).toBe(renamed);
    }
  );

  it.each([
    ['readOnly', false],
    ['readOnly', true],
    ['refOnly', false],
    ['refOnly', true]
  ] as const)('syncs edits with %s files in the same namespace (reference first=%s)', async (flag, referenceFirst) => {
    const referenceSources = [
      `namespace ${NS}\ntype First:\n value int (1..1)\n`,
      `namespace ${NS}\ntype Second:\n value string (1..1)\n`
    ];
    const user = await parse(ROSETTA_SOURCE, `inmemory:///${FILE_PATH}`);
    const references = await Promise.all(
      referenceSources.map((source, index) => parse(source, `system://reference/${index}.rosetta`))
    );
    const referenceFiles = referenceSources.map((content, index) => ({
      name: `${index}.rosetta`,
      path: `system://reference/${index}.rosetta`,
      content,
      dirty: false,
      [flag]: true
    }));
    const userFile = { name: FILE_PATH, path: FILE_PATH, content: ROSETTA_SOURCE, dirty: false };
    const referenceModels = references.map(({ value }) => value);
    const files = referenceFirst ? [...referenceFiles, userFile] : [userFile, ...referenceFiles];
    const models = referenceFirst ? [...referenceModels, user.value] : [user.value, ...referenceModels];
    const onFilesChange = vi.fn();
    renderEditorPage({
      models,
      parsedModels: models.map((model, index) => ({ model, filePath: files[index]!.path })),
      files,
      onFilesChange
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const order = useEditorStore.getState().nodes.find((node) => node.data.name === 'Order')!;
    act(() => useEditorStore.getState().updateCardinality(order.id, 'quantity', '(0..*)'));
    await waitFor(() => expect(onFilesChange).toHaveBeenCalled());
    for (const [updated] of onFilesChange.mock.calls) {
      for (const reference of referenceFiles) {
        expect(updated.find((file: { path: string }) => file.path === reference.path)).toBe(reference);
      }
    }
    const updatedUser = onFilesChange.mock.calls.at(-1)![0].find((file: { path: string }) => file.path === FILE_PATH);
    expect(updatedUser.dirty).toBe(true);
    expect(updatedUser.content).toMatch(/quantity\s+int\s+\(?0\.\.\*\)?/);
  });

  it('fires onFilesChange with changed content when an attribute is edited in Structure mode (graph pane NOT mounted)', async () => {
    // 1. Parse a real Rosetta source so loadModels produces real TypeGraphNodes.
    const parseResult = await parse(ROSETTA_SOURCE, `inmemory:///${FILE_PATH}`);
    expect(parseResult.hasErrors).toBe(false);
    const model = parseResult.value;

    const onFilesChange = vi.fn();

    // 2. Render EditorPage with the real parsed model.
    //    - `models` drives the useEffect that calls loadModels.
    //    - `parsedModels` provides the filePath→namespace mapping for
    //      namespaceToFile so handleModelChanged can map namespace → file.
    //    - `files` has the actual content that will be smart-merged.
    renderEditorPage({
      models: [model],
      parsedModels: [{ filePath: FILE_PATH, model }],
      files: [{ name: FILE_PATH, path: FILE_PATH, content: ROSETTA_SOURCE, dirty: false }],
      onFilesChange
    });

    // 3. Wait for the initial loadModels effect to settle and the
    //    useModelSourceSync initial-skip to record its baseline.
    await act(async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    });

    // Confirm nodes were loaded into the real store.
    const nodes = useEditorStore.getState().nodes;
    const orderNode = nodes.find((n) => n.data.name === 'Order');
    expect(orderNode).toBeDefined();

    // Clear any onFilesChange calls that may have fired during mount/initial
    // effects (e.g. from debounced timers in other hooks).
    onFilesChange.mockClear();

    // 4. Mutate the store exactly as the Structure-pane CardinalityCell does.
    //    Change `quantity` from (1..1) to (0..*).
    act(() => {
      useEditorStore.getState().updateCardinality(orderNode!.id, 'quantity', '(0..*)');
    });

    // 5. Assert onFilesChange fires.  The regression: before the fix this
    //    waitFor would time out because the subscription only fired when
    //    RuneTypeGraph was mounted — and our CenterStackPanel stub never
    //    calls renderGraph().
    await waitFor(
      () => {
        expect(onFilesChange).toHaveBeenCalled();
      },
      { timeout: 3000 }
    );

    // 6. Assert the updated file content reflects the cardinality change.
    //    The smart-merge preserves the rest of the source; only the edited
    //    attribute line changes.
    const [updatedFiles] = onFilesChange.mock.calls.at(-1) as [
      Array<{ name: string; path: string; content: string; dirty: boolean }>
    ];
    const updatedFile = updatedFiles.find((f) => f.path === FILE_PATH);

    expect(updatedFile).toBeDefined();
    // The file is marked dirty because content changed.
    expect(updatedFile!.dirty).toBe(true);
    // The serialized output reflects the cardinality edit.
    // serializeModel may emit with or without wrapping parens, e.g.
    // `0..*` or `(0..*)` — match flexibly.
    expect(updatedFile!.content).toMatch(/quantity\s+int\s+\(?0\.\.\*\)?/);
    // The original (1..1) form should no longer appear on the quantity line.
    expect(updatedFile!.content).not.toMatch(/quantity\s+int\s+\(?1\.\.1\)?/);
  });
});
