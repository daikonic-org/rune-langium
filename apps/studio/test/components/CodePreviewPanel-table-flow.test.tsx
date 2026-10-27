// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * 018 Phase 0 Task 0.8 — integration coverage for the table-as-landing
 * flow on CodePreviewPanel (post-Codex-P2 edition).
 *
 * CodePreviewPanel is now a PURE-DISPLAY component. Worker ownership
 * (codegen:generate postMessage + response listener) lives in CodegenProvider.
 * This file tests only what the component is responsible for:
 *
 *   - Panel mounts to the targets table when activeTarget=undefined.
 *   - No worker postMessage is called from the panel (worker is CodegenProvider's).
 *   - Clicking [View] updates the store (activeTarget, codePreviewTarget)
 *     and expands the viewer — CodegenProvider's effect would then trigger codegen.
 *   - Clicking the eye again toggles the preview off.
 *   - Clicking [Download] opens the modal and POSTs to /api/codegen.
 *
 * Assertions that the panel calls worker.postMessage are removed — the panel
 * no longer owns the worker.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react';

// These tests exercise panel routing/status; real editor cues are covered in CodePreviewPanel-arrival.
vi.mock('../../src/lang/source-navigation-highlight.js', () => ({
  sourceNavigationHighlight: [],
  clearSourceReveal: vi.fn(),
  setSourceReveal: { of: vi.fn(() => ({})) }
}));

vi.mock('@codemirror/view', () => ({
  EditorView: class MockEditorView {
    dom = document.createElement('div');
    state = { doc: { toString: () => '' } };
    destroy = vi.fn();
    dispatch = vi.fn();
    static theme = vi.fn(() => []);
    static updateListener = { of: vi.fn(() => []) };
    static domEventHandlers = vi.fn(() => []);
    static lineWrapping = [];
    static editable = { of: vi.fn(() => []) };
    static contentAttributes = { of: vi.fn(() => []) };
    constructor({ parent }: { parent?: Element }) {
      if (parent) parent.appendChild(this.dom);
    }
  },
  lineNumbers: vi.fn(() => []),
  highlightActiveLine: vi.fn(() => []),
  drawSelection: vi.fn(() => [])
}));
vi.mock('codemirror', () => ({ basicSetup: [] }));
vi.mock('@codemirror/language', () => ({
  StreamLanguage: { define: vi.fn(() => []) },
  HighlightStyle: { define: vi.fn(() => ({})) },
  syntaxHighlighting: vi.fn(() => [])
}));
vi.mock('@codemirror/lang-json', () => ({ json: vi.fn(() => []) }));
vi.mock('@codemirror/lang-javascript', () => ({ javascript: vi.fn(() => []) }));

import { CodePreviewPanel } from '../../src/components/CodePreviewPanel.js';
import { useCodegenStore } from '../../src/store/codegen-store.js';
import { ProjectContext, type ProjectRuntimeState } from '../../src/shell/providers/project-context.js';
import { WorkspaceStateContext, type WorkspaceState } from '../../src/shell/providers/workspace-context.js';
import { projectOverrideInput } from '../helpers/project-override-input.js';
import { parse } from '@rune-langium/core';
import { requestCodegenDownload } from '../../src/services/codegen-download-client.js';

vi.mock('../../src/services/codegen-download-client.js', () => ({ requestCodegenDownload: vi.fn() }));

async function managedDownloadFixture() {
  const { input, files } = await projectOverrideInput();
  const models = await Promise.all(
    [...files, ...input.referenceDocuments].map(async (file) => (await parse(file.content)).value!)
  );
  const workspace = { workspaceId: 'p', models } as WorkspaceState;
  const ui = (runtime: ProjectRuntimeState = { managed: true, status: 'captured', input, diagnostics: [] }) => (
    <ProjectContext.Provider value={{ status: 'ready', diagnostics: [], runtime }}>
      <WorkspaceStateContext.Provider value={workspace}>
        <CodePreviewPanel sourceEditorRef={null} files={files} />
      </WorkspaceStateContext.Provider>
    </ProjectContext.Provider>
  );
  return { input, ui };
}

async function generateResponse(body: Record<string, unknown>) {
  const { handleCodegenDownload } = await import('../../src/services/codegen-download-handler.js');
  const { project, ...payload } = body;
  return handleCodegenDownload({
    project,
    request: new Request('https://example.com/api/codegen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
  } as never);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => {
  useCodegenStore.getState().resetCodegenState();
  vi.mocked(requestCodegenDownload).mockReset();
});

describe('CodePreviewPanel table-as-landing flow', () => {
  it('renders the targets table on initial mount (activeTarget undefined)', () => {
    render(<CodePreviewPanel sourceEditorRef={null} />);
    expect(screen.getByTestId('codegen-targets-table')).toBeTruthy();
    expect(screen.queryByTestId('code-preview-editor')).toBeNull();
  });

  it('does not require a worker prop to mount', () => {
    // Verifies the component is a pure display component.
    expect(() => render(<CodePreviewPanel sourceEditorRef={null} />)).not.toThrow();
  });

  it('clicking the eye on a row opens the preview below the table (table stays visible)', () => {
    render(<CodePreviewPanel sourceEditorRef={null} />);
    fireEvent.click(screen.getByTestId('codegen-targets-table__view-typescript'));
    // store transitions to viewer mode
    expect(useCodegenStore.getState().activeTarget).toBe('typescript');
    expect(useCodegenStore.getState().codePreviewTarget).toBe('typescript');
    // 019 polish — table stays mounted; viewer expands below it.
    expect(screen.getByTestId('codegen-targets-table')).toBeTruthy();
    expect(screen.getByTestId('code-preview-editor')).toBeTruthy();
    // Note: CodegenProvider (not the panel) sends the codegen:generate postMessage.
    // We do not assert postMessage here.
  });

  it('regenerates the active target without closing its editor', () => {
    render(<CodePreviewPanel sourceEditorRef={null} />);
    fireEvent.click(screen.getByTestId('codegen-targets-table__view-zod'));
    const editor = screen.getByTestId('code-preview-editor');
    const revision = useCodegenStore.getState().refreshRevision;
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate Zod preview' }));
    expect(useCodegenStore.getState().activeTarget).toBe('zod');
    expect(useCodegenStore.getState().refreshRevision).toBe(revision + 1);
    expect(screen.getByTestId('code-preview-editor')).toBe(editor);
  });

  it('clicking the eye on a different row swaps the preview without closing it', () => {
    render(<CodePreviewPanel sourceEditorRef={null} />);
    fireEvent.click(screen.getByTestId('codegen-targets-table__view-zod'));
    expect(useCodegenStore.getState().activeTarget).toBe('zod');
    fireEvent.click(screen.getByTestId('codegen-targets-table__view-typescript'));
    expect(useCodegenStore.getState().activeTarget).toBe('typescript');
    expect(useCodegenStore.getState().codePreviewTarget).toBe('typescript');
    expect(screen.getByTestId('code-preview-editor')).toBeTruthy();
  });

  it('does not render the old TargetSwitcher tabs in either mode', () => {
    render(<CodePreviewPanel sourceEditorRef={null} />);
    expect(screen.queryByTestId('target-switcher')).toBeNull();
    fireEvent.click(screen.getByTestId('codegen-targets-table__view-zod'));
    expect(screen.queryByTestId('target-switcher')).toBeNull();
  });

  // 018 Task 0.12 — clicking [Download] should POST to /api/codegen,
  // show a spinner on the clicked row while in-flight, then clear it
  // once the fetch resolves. The download itself is exercised by
  // workspace-download.test.ts; here we just verify the panel-level
  // wiring: fetch is invoked with the workspace files, and the table's
  // spinner reflects the in-flight state.
  it('clicking [Download] posts to /api/codegen with the workspace files', async () => {
    let resolveFetch: (res: Response) => void = () => {};
    const fetchMock = vi.fn(
      (_url: string, _init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );
    vi.mocked(requestCodegenDownload).mockImplementation((body, signal) =>
      fetchMock('/api/codegen', { body: JSON.stringify(body), signal })
    );
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);

    const files = [
      { name: 'x.rune', path: 'x.rune', content: 'namespace x\ntype T:\n  a string (1..1)\n', dirty: false }
    ];
    render(<CodePreviewPanel sourceEditorRef={null} files={files as never} />);

    // §5.1 — Download now opens the config modal first; Generate fires the
    // request. With no dep graph populated (empty store), the modal has no
    // namespaces to narrow and emits everything.
    await act(async () => {
      fireEvent.click(screen.getByTestId('codegen-targets-table__download-zod'));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('download-config-dialog__generate'));
    });

    // Spinner appears on the zod row while the fetch is pending.
    expect(screen.getByTestId('codegen-targets-table__spinner-zod')).toBeTruthy();
    expect(screen.queryByTestId('codegen-targets-table__view-zod')).toBeNull();

    // Fetch was invoked with the right URL + body.
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/codegen');
    const body = JSON.parse((init as RequestInit).body as string) as {
      files: Array<{ path: string; content: string }>;
      target: string;
    };
    expect(body.target).toBe('zod');
    expect(body.files).toEqual([{ path: 'x.rune', content: files[0]!.content }]);

    // Resolve the fetch with a successful response so the spinner clears.
    await act(async () => {
      resolveFetch(
        new Response('out', {
          status: 200,
          headers: { 'Content-Disposition': 'attachment; filename="x.zod.ts"' }
        })
      );
    });

    // Spinner gone; row buttons are back.
    expect(screen.queryByTestId('codegen-targets-table__spinner-zod')).toBeNull();
    expect(screen.getByTestId('codegen-targets-table__view-zod')).toBeTruthy();

    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('downloads accepted reference namespaces from the captured project, with effective dependencies and receipt', async () => {
    const { input, ui } = await managedDownloadFixture();
    useCodegenStore.getState().setDependencyGraph({ stale: ['stale'] });
    const request = vi.mocked(requestCodegenDownload).mockImplementation(generateResponse);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(ui());
    fireEvent.click(screen.getByTestId('codegen-targets-table__download-typescript'));
    expect(screen.getByTestId('download-config-dialog__ns-row-ref')).toBeVisible();
    expect(screen.queryByTestId('download-config-dialog__ns-row-stale')).toBeNull();
    fireEvent.click(screen.getByTestId('download-config-dialog__ns-row-custom').querySelector('button')!);
    await act(async () => {
      fireEvent.click(screen.getByTestId('download-config-dialog__generate'));
    });
    const body = request.mock.calls.at(-1)![0];
    expect(body.project).toBe(input);
    expect(body.selection).toEqual({ namespaces: ['ref'], declarations: [] });
    expect(body.artifactEnvelope).toBe(1);
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledOnce());
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0]![0] as Blob;
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(new Uint8Array(await blob.arrayBuffer()));
    const manifest = JSON.parse(await zip.file('.rune/export.json')!.async('string'));
    expect(manifest.projectReceipt).toEqual(input.receipt);
    expect(manifest.resolvedSelection.included).toContainEqual({
      namespace: 'custom',
      name: 'Compute',
      kind: 'RosettaFunction'
    });
  });

  it('closes stale choices and refuses a managed download until the new capture is ready', async () => {
    const { ui } = await managedDownloadFixture();
    const { rerender } = render(ui());
    fireEvent.click(screen.getByTestId('codegen-targets-table__download-typescript'));
    expect(screen.getByTestId('download-config-dialog')).toBeVisible();
    rerender(ui({ managed: true, status: 'loading', diagnostics: [] }));
    expect(screen.queryByTestId('download-config-dialog')).toBeNull();
    fireEvent.click(screen.getByTestId('codegen-targets-table__download-typescript'));
    expect(screen.queryByTestId('download-config-dialog')).toBeNull();
    expect(requestCodegenDownload).not.toHaveBeenCalled();
  });

  it('aborts an in-flight download when its capture changes and discards even a late successful artifact', async () => {
    const { ui } = await managedDownloadFixture();
    const pending = Promise.withResolvers<Response>();
    const request = vi.mocked(requestCodegenDownload).mockReturnValue(pending.promise);
    const save = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    const { rerender } = render(ui());
    fireEvent.click(screen.getByTestId('codegen-targets-table__download-typescript'));
    fireEvent.click(screen.getByTestId('download-config-dialog__generate'));
    const [body, signal] = request.mock.calls[0]!;
    rerender(ui({ managed: true, status: 'loading', diagnostics: [] }));
    expect(signal!.aborted).toBe(true);
    await act(async () => {
      pending.resolve(await generateResponse(body));
    });
    await waitFor(() => expect(screen.queryByTestId('codegen-targets-table__spinner-typescript')).toBeNull());
    expect(save).not.toHaveBeenCalled();
  });
});
