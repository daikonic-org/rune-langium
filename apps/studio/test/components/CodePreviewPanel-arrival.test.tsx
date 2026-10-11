// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

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
