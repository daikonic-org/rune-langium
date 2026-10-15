// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, act, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { undo, redo } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { makeNodeId, type FunctionScope } from '@rune-langium/visual-editor';
import {
  parse,
  serializeRuneModel,
  createRuneDslServices,
  type RosettaFunction,
  type Dehydrated
} from '@rune-langium/core';
import { ExpressionWorkspace } from '../../src/components/editing/ExpressionWorkspace.js';
import { ExpressionDocument } from '../../src/services/expression-document.js';
import type { WorkspaceFile } from '../../src/services/workspace.js';
import * as workspaceServices from '../../src/services/workspace.js';
import { PreviewSessionContext } from '../../src/shell/providers/preview-session-context.js';
import { pathToUri } from '../../src/utils/uri.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const source = 'namespace test\nversion "test"\nfunc Calculate:\n  output: result int (1..1)\n  set result: 1\n';

async function context() {
  const result = await parse(source);
  let file: WorkspaceFile = { path: '/first.rosetta', name: 'first.rosetta', content: source, dirty: false };
  const sibling = { ...file, path: '/second.rosetta', name: 'second.rosetta' };
  const writes = vi.fn((_: string, text: string) => {
    file = { ...file, content: text };
  });
  const documents = new ExpressionDocument({ getGeneration: () => 1, getFile: () => file, onContentChange: writes });
  const props = {
    nodeId: makeNodeId('test', 'Calculate', 'RosettaFunction'),
    file,
    parsed: { filePath: file.path, model: result.value, source },
    documents,
    parseCurrent: true,
    readOnly: false,
    onContentChange: writes,
    onOpenSource: vi.fn()
  };
  return {
    props,
    sibling,
    writes,
    getFile: () => file,
    setFile: (next: WorkspaceFile) => {
      file = next;
      documents.observe(pathToUri(file.path));
    }
  };
}

describe('source-bound expression workspace', () => {
  it('retries a failed projection without changing or remounting the source editor', async () => {
    const { props, writes } = await context();
    const project = vi
      .fn()
      .mockRejectedValueOnce(new Error('Preparing preview timed out.'))
      .mockImplementation(async (language, subject) => ({
        language,
        subject,
        code: 'return 1;',
        sourceMap: [],
        requiredHelpers: []
      }));
    const factory = () => ({ schema: vi.fn(), execute: vi.fn(), project, dispose: vi.fn() });
    const host = render(
      <PreviewSessionContext.Provider value={factory}>
        <ExpressionWorkspace {...props} />
      </PreviewSessionContext.Provider>
    );
    const editor = await host.findByTestId('implementation-editor');
    const view = EditorView.findFromDOM(editor.querySelector('.cm-editor')!)!;
    fireEvent.click(host.getByRole('button', { name: 'TypeScript' }));
    await waitFor(() => expect(host.getByRole('alert')).toHaveTextContent('timed out'));
    fireEvent.click(host.getByRole('button', { name: 'Retry generation' }));
    await waitFor(() => expect(host.getByTestId('generated-expression')).toHaveTextContent('return 1;'));
    expect(project).toHaveBeenCalledTimes(2);
    expect(EditorView.findFromDOM(editor.querySelector('.cm-editor')!)).toBe(view);
    expect(writes).not.toHaveBeenCalled();
  });
  it('rejects scope loaded for a superseded dependency snapshot', async () => {
    const { props, sibling, writes } = await context();
    let finish!: (scope: FunctionScope) => void;
    const loadScope = vi.fn(
      () =>
        new Promise<FunctionScope>((resolve) => {
          finish = resolve;
        })
    );
    const host = render(
      <ExpressionWorkspace {...props} dependencySnapshot={[props.file, sibling]} loadScope={loadScope} />
    );
    const editor = await host.findByTestId('implementation-editor');
    const view = EditorView.findFromDOM(editor.querySelector('.cm-editor')!)!;
    act(() => view.dispatch({ selection: { anchor: source.indexOf('1\n') } }));
    fireEvent.click(host.getByRole('button', { name: 'Builder' }));
    expect(loadScope).toHaveBeenCalledOnce();
    host.rerender(<ExpressionWorkspace {...props} dependencySnapshot={[props.file]} loadScope={loadScope} />);
    await act(async () => finish({ inputs: [], aliases: [], output: null }));
    expect(host.queryByRole('dialog')).toBeNull();
    expect(host.getByRole('alert')).toHaveTextContent('The source changed');
    expect(writes).not.toHaveBeenCalled();
  });

  it.each(['modified', 'added', 'removed'])(
    'keeps a private draft when a dependency is %s before Apply',
    async (change) => {
      const { props, sibling, writes } = await context();
      const loadScope = async () => ({ inputs: [], aliases: [], output: null });
      const host = render(
        <ExpressionWorkspace {...props} dependencySnapshot={[props.file, sibling]} loadScope={loadScope} />
      );
      const editor = await host.findByTestId('implementation-editor');
      const view = EditorView.findFromDOM(editor.querySelector('.cm-editor')!)!;
      act(() => view.dispatch({ selection: { anchor: source.indexOf('1\n') } }));
      fireEvent.click(host.getByRole('button', { name: 'Builder' }));
      await host.findByRole('dialog');
      fireEvent.click(host.getByTestId('tab-text'));
      const draft = EditorView.findFromDOM(host.getByTestId('text-editor').querySelector('.cm-editor')!)!;
      act(() => draft.dispatch({ changes: { from: 0, to: draft.state.doc.length, insert: 'Sibling()' } }));
      const dependencies =
        change === 'removed'
          ? [props.file]
          : change === 'added'
            ? [props.file, sibling, { ...sibling, path: '/third.rosetta' }]
            : [props.file, { ...sibling, content: source.replace('Calculate', 'Changed') }];
      host.rerender(<ExpressionWorkspace {...props} dependencySnapshot={dependencies} loadScope={loadScope} />);
      fireEvent.click(host.getByRole('button', { name: 'Apply' }));
      expect(writes).not.toHaveBeenCalled();
      expect(host.getByText('The source changed. Reopen the builder to apply this draft.')).toBeVisible();
      expect(draft.state.doc.toString()).toBe('Sibling()');
    }
  );

  it.each([false, true])('binds the dispatch base implementation with serialized=%s', async (serialized) => {
    const text =
      'namespace test\nenum Kind:\n Cash\nfunc Compute(kind: Kind -> Cash):\n set result: amount + 1\nfunc Compute:\n inputs: kind Kind (1..1)\n          amount int (1..1)\n output: result int (1..1)\n set result: amount\n';
    const parsed = await parse(text);
    expect(parsed.parserErrors).toEqual([]);
    const services = createRuneDslServices();
    const model = serialized
      ? JSON.parse(serializeRuneModel(services.RuneDsl.serializer.JsonSerializer, parsed.value))
      : parsed.value;
    const { props } = await context();
    const file = { ...props.file, content: text };
    const writes = vi.fn();
    const documents = new ExpressionDocument({ getGeneration: () => 1, getFile: () => file, onContentChange: writes });
    const loadScope = vi.fn(async () => ({ inputs: [], aliases: [], output: null }));
    const host = render(
      <ExpressionWorkspace
        {...props}
        nodeId={makeNodeId('test', 'Compute', 'RosettaFunction')}
        file={file}
        documents={documents}
        onContentChange={writes}
        parsed={{ filePath: file.path, model, source: text }}
        loadScope={loadScope}
      />
    );
    const editor = await host.findByTestId('implementation-editor');
    const view = EditorView.findFromDOM(editor.querySelector('.cm-editor')!)!;
    const from = text.lastIndexOf('amount\n');
    act(() => view.dispatch({ selection: { anchor: from } }));
    fireEvent.click(host.getByRole('button', { name: 'Builder' }));
    await host.findByRole('dialog');
    expect(loadScope).toHaveBeenCalledExactlyOnceWith({ from, to: from + 'amount'.length });
    fireEvent.click(host.getByTestId('tab-text'));
    const draft = EditorView.findFromDOM(host.getByTestId('text-editor').querySelector('.cm-editor')!)!;
    expect(draft.state.doc.toString()).toBe('amount');
    expect(writes).not.toHaveBeenCalled();
  });

  it.each(['function-body', 'function-condition', 'data-condition'] as const)(
    'binds the correct same-named declaration for %s',
    async (mode) => {
      const text =
        'namespace test\ntype Shared:\n amount int (1..1)\n condition DataValid: amount > 0\nfunc Shared:\n inputs: factor int (1..1)\n output: out int (1..1)\n condition FunctionValid: factor > 1\n set out: factor + 2';
      const result = await parse(text);
      expect(result.parserErrors).toEqual([]);
      const { props } = await context();
      const file = { ...props.file, content: text };
      const writes = vi.fn();
      const documents = new ExpressionDocument({
        getGeneration: () => 1,
        getFile: () => file,
        onContentChange: writes
      });
      const nodeId = makeNodeId('test', 'Shared', mode === 'data-condition' ? 'Data' : 'RosettaFunction');
      const loadScope = vi.fn(async () => ({ inputs: [], aliases: [], output: null }));
      const host = render(
        <ExpressionWorkspace
          {...props}
          nodeId={nodeId}
          file={file}
          documents={documents}
          onContentChange={writes}
          parsed={{ filePath: file.path, model: result.value, source: text }}
          loadScope={loadScope}
          target={mode === 'function-body' ? undefined : { nodeId, kind: 'precondition', index: 0 }}
        />
      );
      const editor = await host.findByTestId('implementation-editor');
      const view = EditorView.findFromDOM(editor.querySelector('.cm-editor')!)!;
      const expression =
        mode === 'function-body' ? 'factor + 2' : mode === 'function-condition' ? 'factor > 1' : 'amount > 0';
      const from = text.indexOf(expression);
      act(() => view.dispatch({ selection: { anchor: from } }));
      fireEvent.click(host.getByRole('button', { name: 'Builder' }));
      await host.findByRole('dialog');
      expect(loadScope).toHaveBeenCalledExactlyOnceWith({ from, to: from + expression.length });
      fireEvent.click(host.getByTestId('tab-text'));
      const draft = EditorView.findFromDOM(host.getByTestId('text-editor').querySelector('.cm-editor')!)!;
      expect(draft.state.doc.toString()).toBe(expression);
      expect(writes).not.toHaveBeenCalled();
    }
  );

  it('reopens and repairs an invalid draft after Inspector disposal', async () => {
    const { props, getFile } = await context();
    const first = render(<ExpressionWorkspace {...props} />);
    const editor = await first.findByTestId('implementation-editor');
    const view = EditorView.findFromDOM(editor.querySelector('.cm-editor')!)!;
    const from = source.indexOf('1\n');
    act(() => view.dispatch({ changes: { from, to: from + 1, insert: 'if (' } }));
    first.rerender(<ExpressionWorkspace {...props} file={getFile()} parseCurrent={false} />);
    first.unmount();
    const second = render(<ExpressionWorkspace {...props} file={getFile()} parseCurrent={false} />);
    const reopened = await second.findByTestId('implementation-editor');
    const current = EditorView.findFromDOM(reopened.querySelector('.cm-editor')!)!;
    expect(current.state.doc.toString()).toContain('if (');
    act(() => current.dispatch({ changes: { from, to: from + 4, insert: '2' } }));
    expect(getFile().content).toBe(source.replace('1\n', '2\n'));
    expect(second.getByRole('button', { name: 'Builder' })).toBeDisabled();
  });
  it.each(['TypeScript', 'Python'])(
    'displays generated %s read-only, caches tab clicks, and retains stale output for invalid Rune',
    async (tab) => {
      const declaration = tab === 'Python' ? 'def Calculate' : 'export function Calculate';
      const { props, writes, getFile } = await context();
      const project = vi.fn(async (language, subject) => ({
        language,
        subject,
        code:
          tab === 'Python'
            ? 'def Calculate(input: Calculate_Input) -> float:\n    return 1.0\n'
            : 'export function Calculate(): number { return 1; }',
        sourceMap: [],
        requiredHelpers: []
      }));
      const factory = () => ({ schema: vi.fn(), execute: vi.fn(), project, dispose: vi.fn() });
      const renderWorkspace = (current = props) => (
        <PreviewSessionContext.Provider value={factory}>
          <ExpressionWorkspace {...current} />
        </PreviewSessionContext.Provider>
      );
      const host = render(renderWorkspace());
      const editor = await host.findByTestId('implementation-editor');
      const view = EditorView.findFromDOM(editor.querySelector('.cm-editor')!)!;
      fireEvent.click(host.getByRole('button', { name: tab }));
      await waitFor(() => expect(host.getByTestId('generated-expression')).toHaveTextContent(declaration));
      const generated = EditorView.findFromDOM(host.getByTestId('generated-expression').querySelector('.cm-editor')!)!;
      act(() => generated.dispatch({ changes: { from: 0, insert: 'invalid' } }));
      expect(writes).not.toHaveBeenCalled();
      fireEvent.click(host.getByRole('button', { name: 'Rune' }));
      fireEvent.click(host.getByRole('button', { name: tab }));
      expect(project).toHaveBeenCalledOnce();
      fireEvent.click(host.getByRole('button', { name: 'Rune' }));
      act(() => view.dispatch({ changes: { from: source.indexOf('1\n'), insert: 'if (' } }));
      host.rerender(renderWorkspace({ ...props, file: getFile(), parseCurrent: false }));
      fireEvent.click(host.getByRole('button', { name: tab }));
      expect(host.getByTestId('generated-expression')).toHaveTextContent(declaration);
      expect(host.getByRole('status')).toHaveTextContent('last valid source');
      expect(project).toHaveBeenCalledOnce();
    }
  );
  it('keeps invalid text editable during pending/failed parses and writes only the owning file', async () => {
    const { props, sibling, writes, getFile } = await context();
    const host = render(<ExpressionWorkspace {...props} />);
    const editor = await host.findByTestId('implementation-editor');
    const view = EditorView.findFromDOM(editor.querySelector('.cm-editor')!)!;
    const from = source.indexOf('1\n');
    act(() => view.dispatch({ changes: { from, to: from + 1, insert: 'if (' } }));
    expect(writes).toHaveBeenLastCalledWith('/first.rosetta', source.replace('1\n', 'if (\n'));
    host.rerender(<ExpressionWorkspace {...props} file={getFile()} parseCurrent={false} />);
    expect(view.state.doc.toString()).toContain('if (');
    act(() => view.dispatch({ changes: { from: from + 4, insert: 'x' } }));
    expect(view.state.doc.toString()).toContain('if (x');
    expect(sibling.content).toBe(source);
  });

  it.each(['rename', 'delete'])(
    'invalidates the editor when a current parse confirms declaration %s',
    async (change) => {
      const { props, writes, getFile } = await context();
      const host = render(<ExpressionWorkspace {...props} />);
      await host.findByTestId('implementation-editor');
      const updated = change === 'rename' ? source.replace('Calculate', 'Renamed') : 'namespace test\nversion "test"\n';
      writes(props.file.path, updated);
      writes.mockClear();
      const result = await parse(updated);
      host.rerender(
        <ExpressionWorkspace
          {...props}
          file={getFile()}
          parsed={{ filePath: props.file.path, source: updated, model: result.value }}
          parseCurrent
        />
      );
      await waitFor(() => expect(host.queryByTestId('implementation-editor')).toBeNull());
      expect(host.getByRole('button', { name: 'Builder' })).toBeDisabled();
      expect(host.getByRole('status')).toHaveTextContent('no longer present');
      expect(writes).not.toHaveBeenCalled();
    }
  );

  it('applies a builder edit as one CodeMirror undo entry', async () => {
    const { props, writes } = await context();
    const loadScope = vi.fn(async () => ({ inputs: [], aliases: [], output: null }));
    const host = render(<ExpressionWorkspace {...props} loadScope={loadScope} />);
    const editor = await host.findByTestId('implementation-editor');
    const view = EditorView.findFromDOM(editor.querySelector('.cm-editor')!)!;
    act(() => view.dispatch({ selection: { anchor: source.indexOf('1\n') } }));
    fireEvent.click(host.getByRole('button', { name: 'Builder' }));
    await host.findByRole('dialog');
    fireEvent.click(host.getByTestId('tab-text'));
    const draftView = EditorView.findFromDOM(host.getByTestId('text-editor').querySelector('.cm-editor')!)!;
    act(() => draftView.dispatch({ changes: { from: 0, to: draftView.state.doc.length, insert: '42' } }));
    expect(writes).not.toHaveBeenCalled();
    fireEvent.click(host.getByRole('button', { name: 'Apply' }));
    expect(view.state.doc.toString()).toBe(source.replace('1\n', '42\n'));
    expect(writes).toHaveBeenCalledOnce();
    await waitFor(() => expect(view.hasFocus).toBe(true));
    act(() => undo(view));
    expect(view.state.doc.toString()).toBe(source);
    act(() => redo(view));
    expect(view.state.doc.toString()).toBe(source.replace('1\n', '42\n'));
  });

  it('rejects an external source update while the builder is open, keeping the private draft', async () => {
    const { props, writes } = await context();
    const loadScope = async () => ({ inputs: [], aliases: [], output: null });
    const host = render(<ExpressionWorkspace {...props} loadScope={loadScope} />);
    const editor = await host.findByTestId('implementation-editor');
    const view = EditorView.findFromDOM(editor.querySelector('.cm-editor')!)!;
    act(() => view.dispatch({ selection: { anchor: source.indexOf('1\n') } }));
    fireEvent.click(host.getByRole('button', { name: 'Builder' }));
    await host.findByRole('dialog');
    fireEvent.click(host.getByTestId('tab-text'));
    const draftView = EditorView.findFromDOM(host.getByTestId('text-editor').querySelector('.cm-editor')!)!;
    act(() => draftView.dispatch({ changes: { from: 0, to: draftView.state.doc.length, insert: '42' } }));
    host.rerender(
      <ExpressionWorkspace
        {...props}
        loadScope={loadScope}
        parseCurrent={false}
        file={{ ...props.file, content: source.replace('1\n', '3\n') }}
      />
    );
    fireEvent.click(host.getByRole('button', { name: 'Apply' }));
    expect(writes).not.toHaveBeenCalled();
    expect(host.getByText('The source changed. Reopen the builder to apply this draft.')).toBeVisible();
    expect(
      EditorView.findFromDOM(host.getByTestId('text-editor').querySelector('.cm-editor')!)!.state.doc.toString()
    ).toBe('42');
  });

  it.each(['reorder', 'delete'])('rejects a captured condition after source %s', async (reason) => {
    const text =
      'namespace test\nversion "test"\ntype Deal:\n amount int (1..1)\n condition First: amount > 0\n condition Second: amount < 10';
    const parsed = await parse(text);
    let file: WorkspaceFile = { path: '/rules.rosetta', name: 'rules.rosetta', content: text, dirty: false };
    const writes = vi.fn();
    const documents = new ExpressionDocument({ getGeneration: () => 1, getFile: () => file, onContentChange: writes });
    const props = {
      nodeId: makeNodeId('test', 'Deal'),
      file,
      parsed: { filePath: file.path, model: parsed.value, source: text },
      documents,
      readOnly: false,
      parseCurrent: true,
      target: { nodeId: makeNodeId('test', 'Deal'), kind: 'precondition' as const, index: 1 },
      onContentChange: writes,
      onOpenSource: vi.fn(),
      loadScope: async () => ({ inputs: [], aliases: [], output: null })
    };
    const host = render(<ExpressionWorkspace {...props} />);
    await host.findByTestId('implementation-editor');
    fireEvent.click(host.getByRole('button', { name: 'Builder' }));
    await host.findByRole('dialog');
    fireEvent.click(host.getByTestId('tab-text'));
    const draft = EditorView.findFromDOM(host.getByTestId('text-editor').querySelector('.cm-editor')!)!;
    act(() => draft.dispatch({ changes: { from: 0, to: draft.state.doc.length, insert: 'amount < 20' } }));
    file = {
      ...file,
      content:
        reason === 'delete'
          ? text.replace('\n condition Second: amount < 10', '')
          : text.replace(
              'condition First: amount > 0\n condition Second: amount < 10',
              'condition Second: amount < 10\n condition First: amount > 0'
            )
    };
    documents.observe('file:///rules.rosetta');
    host.rerender(<ExpressionWorkspace {...props} file={file} parseCurrent={false} />);
    fireEvent.click(host.getByRole('button', { name: 'Apply' }));
    expect(writes).not.toHaveBeenCalled();
    expect(host.getByRole('alert')).toHaveTextContent('The source changed. Reopen the builder');
    expect(draft.state.doc.toString()).toBe('amount < 20');
  });

  it('waits for curated source and then displays the serialized declaration read-only', async () => {
    const { props, writes } = await context();
    const { RuneDsl } = createRuneDslServices();
    const wire = JSON.parse(serializeRuneModel(RuneDsl.serializer.JsonSerializer, props.parsed.model));
    const owner = wire.elements[0] as Dehydrated<RosettaFunction>;
    const host = render(
      <ExpressionWorkspace
        {...props}
        parsed={undefined}
        parseCurrent={false}
        sourceOwner={owner}
        readOnly
        file={{ ...props.file, content: '', sourceLoaded: false, readOnly: true }}
      />
    );
    expect(host.queryByTestId('implementation-editor')).toBeNull();
    expect(host.getByText('Loading source…')).toBeVisible();
    host.rerender(
      <ExpressionWorkspace
        {...props}
        parsed={undefined}
        parseCurrent={false}
        sourceOwner={owner}
        readOnly
        file={{ ...props.file, sourceLoaded: true, readOnly: true }}
      />
    );
    const editor = await host.findByTestId('implementation-editor');
    const view = await waitFor(() => {
      const element = editor.querySelector('.cm-editor');
      expect(element).not.toBeNull();
      const mounted = EditorView.findFromDOM(element!);
      expect(mounted).not.toBeNull();
      return mounted!;
    });
    act(() => view.dispatch({ changes: { from: source.indexOf('1\n'), insert: 'broken' } }));
    expect(view.state.doc.toString()).toBe(source);
    expect(writes).not.toHaveBeenCalled();
  });

  it('uses original curated source boundaries despite drifted serialized offsets', async () => {
    const text = source + 'func Neighbor:\n output: result int (1..1)\n set result: 2\n';
    const parsed = await parse(text.replace('namespace test', 'namespace     test'));
    const { RuneDsl } = createRuneDslServices();
    const owner = JSON.parse(serializeRuneModel(RuneDsl.serializer.JsonSerializer, parsed.value)).elements[0];
    const { props, writes, setFile } = await context();
    const file = { ...props.file, content: text, sourceLoaded: true, readOnly: true, refOnly: true };
    setFile(file);
    const host = render(
      <ExpressionWorkspace
        {...props}
        sourceOwner={owner}
        parsed={undefined}
        parseCurrent={false}
        readOnly
        file={file}
      />
    );
    const editor = await host.findByTestId('implementation-editor');
    expect(editor).toHaveTextContent('set result: 1');
    expect(editor).not.toHaveTextContent('func');
    expect(editor).not.toHaveTextContent('Neighbor');
    expect(writes).not.toHaveBeenCalled();
  });

  it.each([
    ['Rune', 'invalid'],
    ['Rune', 'rejected'],
    ['TypeScript', 'invalid'],
    ['TypeScript', 'rejected']
  ] as const)('clears replaced readonly %s source when coordinate parsing is %s', async (language, outcome) => {
    const { props, setFile } = await context();
    const file = { ...props.file, readOnly: true, refOnly: true, sourceLoaded: true };
    const project = vi.fn(async (target, subject) => ({
      language: target,
      subject,
      code: 'return 1;',
      sourceMap: [],
      requiredHelpers: []
    }));
    const factory = () => ({ schema: vi.fn(), execute: vi.fn(), project, dispose: vi.fn() });
    const view = (currentFile: WorkspaceFile) => {
      setFile(currentFile);
      return (
        <PreviewSessionContext.Provider value={factory}>
          <ExpressionWorkspace {...props} file={currentFile} readOnly parsed={undefined} parseCurrent={false} />
        </PreviewSessionContext.Provider>
      );
    };
    const host = render(view(file));
    await waitFor(() => expect(host.getByTestId('implementation-editor')).toHaveTextContent('set result: 1'));
    if (language === 'TypeScript') {
      fireEvent.click(host.getByRole('button', { name: 'TypeScript' }));
      await waitFor(() => expect(host.getByTestId('generated-expression')).toHaveTextContent('return 1;'));
    }
    let reject!: (reason: Error) => void;
    let resolve!: (result: Awaited<ReturnType<typeof workspaceServices.parseFile>>) => void;
    const pending = new Promise<Awaited<ReturnType<typeof workspaceServices.parseFile>>>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    vi.spyOn(workspaceServices, 'parseFile').mockReturnValueOnce(pending);
    host.rerender(view({ ...file, content: 'namespace test\nfunc Calculate: broken' }));
    expect(host.queryByTestId('implementation-editor')).toBeNull();
    expect(host.queryByTestId('generated-expression')).toBeNull();
    await act(async () => {
      if (outcome === 'rejected') reject(new Error('coordinate parser failed'));
      else resolve({ errors: ['Invalid refreshed source.'] });
    });
    expect(host.getByRole('status')).toHaveTextContent('The original source could not be parsed');
    expect(host.queryByTestId('implementation-editor')).toBeNull();
    expect(host.queryByTestId('generated-expression')).toBeNull();
    host.rerender(view(file));
    if (language === 'TypeScript')
      await waitFor(() => expect(host.getByTestId('generated-expression')).toHaveTextContent('return 1;'));
    else await waitFor(() => expect(host.getByTestId('implementation-editor')).toHaveTextContent('set result: 1'));
  });

  it('hides readonly Rune source when the current bytes have only lexer errors', async () => {
    const { props, setFile } = await context();
    const file = { ...props.file, content: source + '\u0000', readOnly: true, refOnly: true, sourceLoaded: true };
    const parsed = await parse(file.content);
    expect(parsed.parserErrors).toHaveLength(0);
    expect(parsed.lexerErrors.length).toBeGreaterThan(0);
    setFile(file);
    const host = render(
      <ExpressionWorkspace {...props} file={file} readOnly parsed={undefined} parseCurrent={false} />
    );
    await waitFor(() => expect(host.getByRole('status')).toHaveTextContent('The original source could not be parsed'));
    expect(host.queryByTestId('implementation-editor')).toBeNull();
  });

  it('respects file read-only capability even if the host flag is false', async () => {
    const { props, writes } = await context();
    const host = render(
      <ExpressionWorkspace
        {...props}
        file={{ ...props.file, readOnly: true }}
        loadScope={async () => ({ inputs: [], aliases: [], output: null })}
      />
    );
    const editor = await host.findByTestId('implementation-editor');
    await waitFor(() => expect(editor.querySelector('.cm-editor')).not.toBeNull());
    const view = EditorView.findFromDOM(editor.querySelector('.cm-editor')!)!;
    act(() => view.dispatch({ changes: { from: source.indexOf('1\n'), insert: '9' } }));
    expect(view.state.doc.toString()).toBe(source);
    expect(host.getByRole('button', { name: 'Builder' })).toBeDisabled();
    expect(writes).not.toHaveBeenCalled();
  });

  it('never mounts an empty writable view when the source file is missing', async () => {
    const { props } = await context();
    const host = render(<ExpressionWorkspace {...props} file={undefined} />);
    await waitFor(() => expect(host.queryByTestId('implementation-editor')).toBeNull());
    expect(host.getByRole('button', { name: 'Open in Source' })).toBeVisible();
  });
});
