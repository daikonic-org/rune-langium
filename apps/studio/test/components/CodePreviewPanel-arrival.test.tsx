// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { EditorView } from '@codemirror/view';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CodePreviewPanel } from '../../src/components/CodePreviewPanel.js';
import { useCodegenStore } from '../../src/store/codegen-store.js';
import { usePreviewStore } from '../../src/store/preview-store.js';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() });
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  useCodegenStore.setState({ codePreviewTarget: 'zod', activeTarget: 'zod' });
  useCodegenStore.getState().receiveCodePreviewResult({
    target: 'zod',
    files: [
      { relativePath: 'model.ts', content: 'export type Party = string;\nexport type Trade = Party;', sourceMap: [] }
    ]
  });
  usePreviewStore.getState().setAvailableTargets([
    { id: 'test.Party', name: 'Party', namespace: 'test', kind: 'data' },
    { id: 'test.Trade', name: 'Trade', namespace: 'test', kind: 'data' }
  ]);
  usePreviewStore.getState().selectTarget(undefined);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('highlights generated code arrivals, including repeated already-loaded targets', () => {
  const { container } = render(<CodePreviewPanel sourceEditorRef={null} />);
  const lines = () =>
    Array.from(container.querySelectorAll('.cm-source-reveal-line'), (element) => element.textContent);
  expect(lines()).toEqual([]);
  act(() => usePreviewStore.getState().selectTarget('test.Party'));
  expect(lines()).toEqual(['export type Party = string;']);
  act(() => vi.advanceTimersByTime(1000));
  expect(lines()).toEqual([]);
  act(() => usePreviewStore.getState().selectTarget('test.Party'));
  expect(lines()).toEqual(['export type Party = string;']);
  act(() => usePreviewStore.getState().selectTarget('test.Trade'));
  expect(lines()).toEqual(['export type Trade = Party;']);
  act(() => usePreviewStore.getState().selectTarget(undefined));
  expect(lines()).toEqual([]);
});

it('populates and cues an already-generated file when reopening its preview', () => {
  useCodegenStore.setState({ activeTarget: undefined });
  usePreviewStore.getState().selectTarget('test.Trade');
  const { container } = render(<CodePreviewPanel sourceEditorRef={null} />);
  act(() => useCodegenStore.getState().setActiveTarget('zod'));
  expect(container.querySelector('.cm-source-reveal-line')).toHaveTextContent('export type Trade = Party;');
});

it('does not restart a consumed arrival when target metadata or generated output refreshes', () => {
  const scroll = vi.spyOn(EditorView, 'scrollIntoView');
  const { container } = render(<CodePreviewPanel sourceEditorRef={null} />);
  act(() => usePreviewStore.getState().selectTarget('test.Trade'));
  act(() => vi.advanceTimersByTime(1000));
  scroll.mockClear();
  act(() =>
    usePreviewStore.getState().setAvailableTargets(usePreviewStore.getState().targets.map((target) => ({ ...target })))
  );
  expect(container.querySelector('.cm-source-reveal-line')).toBeNull();
  act(() =>
    useCodegenStore.getState().receiveCodePreviewResult({
      target: 'zod',
      files: [{ relativePath: 'model.ts', content: '// Regenerated\nexport type Trade = string;', sourceMap: [] }]
    })
  );
  expect(container.querySelector('.cm-source-reveal-line')).toBeNull();
  expect(scroll).not.toHaveBeenCalled();
});

it('waits for generated output for a pending arrival and consumes it only once', () => {
  useCodegenStore.setState({ snapshot: { status: 'waiting', target: 'zod' } });
  const { container } = render(<CodePreviewPanel sourceEditorRef={null} />);
  act(() => usePreviewStore.getState().selectTarget('test.Trade'));
  const deliver = () =>
    useCodegenStore.getState().receiveCodePreviewResult({
      target: 'zod',
      files: [{ relativePath: 'model.ts', content: 'export type Trade = string;', sourceMap: [] }]
    });
  act(deliver);
  expect(container.querySelector('.cm-source-reveal-line')).toHaveTextContent('export type Trade');
  act(() => vi.advanceTimersByTime(1000));
  act(deliver);
  expect(container.querySelector('.cm-source-reveal-line')).toBeNull();
});

it('does not reveal a cancelled pending request when output arrives later', () => {
  useCodegenStore.setState({ snapshot: { status: 'waiting', target: 'zod' } });
  const { container } = render(<CodePreviewPanel sourceEditorRef={null} />);
  act(() => usePreviewStore.getState().selectTarget('test.Trade'));
  act(() => usePreviewStore.getState().selectTarget(undefined));
  act(() =>
    useCodegenStore.getState().receiveCodePreviewResult({
      target: 'zod',
      files: [{ relativePath: 'model.ts', content: 'export type Trade = string;', sourceMap: [] }]
    })
  );
  expect(container.querySelector('.cm-source-reveal-line')).toBeNull();
});

it('cancels an arrival when its target disappears instead of replaying after reintroduction', () => {
  const targets = usePreviewStore.getState().targets;
  const { container } = render(<CodePreviewPanel sourceEditorRef={null} />);
  act(() => usePreviewStore.getState().selectTarget('test.Trade'));
  expect(container.querySelector('.cm-source-reveal-line')).not.toBeNull();
  act(() => usePreviewStore.getState().setAvailableTargets([]));
  expect(container.querySelector('.cm-source-reveal-line')).toBeNull();
  act(() => usePreviewStore.getState().setAvailableTargets(targets));
  expect(container.querySelector('.cm-source-reveal-line')).toBeNull();
});
