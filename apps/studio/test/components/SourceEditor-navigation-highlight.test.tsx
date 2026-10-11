// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { EditorView } from '@codemirror/view';
import { SourceEditor, type SourceEditorFile, type SourceEditorRef } from '../../src/components/SourceEditor.js';

const files: SourceEditorFile[] = [
  {
    name: 'model.rosetta',
    path: '/workspace/model.rosetta',
    content: 'namespace example\n\ntype First:\n  value string (1..1)\n\ntype Second:',
    dirty: false
  },
  {
    name: 'other.rosetta',
    path: '/workspace/other.rosetta',
    content: 'namespace example.other\n\ntype Other:',
    dirty: false
  }
];

function setup() {
  const ref = React.createRef<SourceEditorRef>();
  const onContentChange = vi.fn();
  let view: EditorView;
  const onEditorViewCreated = (_path: string, created: EditorView) => {
    view = created;
  };
  const props = { files, onContentChange, onEditorViewCreated };
  const rendered = render(<SourceEditor ref={ref} {...props} />);
  return {
    ...rendered,
    ref,
    props,
    onContentChange,
    get view() {
      return view;
    }
  };
}

function highlightedLines(container: HTMLElement) {
  return Array.from(container.querySelectorAll('.cm-source-reveal-line'), (line) => line.textContent);
}

const rangeGeometry = {
  getBoundingClientRect: Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect'),
  getClientRects: Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  // CodeMirror measures text when a deferred navigation frame is delivered.
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() });
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const [name, descriptor] of Object.entries(rangeGeometry)) {
    if (descriptor) Object.defineProperty(Range.prototype, name, descriptor);
    else Reflect.deleteProperty(Range.prototype, name);
  }
});

describe('SourceEditor destination highlight', () => {
  it('highlights the revealed line for one second without focus or document changes', () => {
    const editor = setup();
    const filter = document.createElement('input');
    document.body.append(filter);
    filter.focus();

    expect(editor.ref.current!.revealLine(3, files[0]!.path)).toBe(true);

    expect(highlightedLines(editor.container)).toEqual(['type First:']);
    expect(editor.view.state.selection.main.anchor).toBe(files[0]!.content.indexOf('type First:'));
    expect(editor.view.state.doc.toString()).toBe(files[0]!.content);
    expect(editor.onContentChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(filter);
    act(() => vi.advanceTimersByTime(999));
    expect(highlightedLines(editor.container)).toEqual(['type First:']);
    act(() => vi.advanceTimersByTime(1));
    expect(highlightedLines(editor.container)).toEqual([]);
    expect(document.activeElement).toBe(filter);
    filter.remove();
  });

  it('replaces the previous line and gives a repeated destination a fresh duration', () => {
    const editor = setup();
    editor.ref.current!.revealLine(3);
    expect(highlightedLines(editor.container)).toEqual(['type First:']);
    act(() => vi.advanceTimersByTime(600));
    editor.ref.current!.revealLine(6);
    expect(highlightedLines(editor.container)).toEqual(['type Second:']);
    act(() => vi.advanceTimersByTime(600));
    expect(highlightedLines(editor.container)).toEqual(['type Second:']);
    editor.ref.current!.revealLine(6);
    act(() => vi.advanceTimersByTime(600));
    expect(highlightedLines(editor.container)).toEqual(['type Second:']);
    act(() => vi.advanceTimersByTime(400));
    expect(highlightedLines(editor.container)).toEqual([]);
  });

  it('highlights same-file position navigation and preserves its focus behavior', () => {
    const editor = setup();
    editor.ref.current!.revealPosition({ line: 3, character: 6 });
    expect(highlightedLines(editor.container)).toEqual(['type First:']);
    expect(editor.view.state.selection.main.anchor).toBe(files[0]!.content.indexOf('First'));
    expect(document.activeElement).toBe(editor.view.contentDOM);
  });

  it('highlights a deferred position only after the destination file mounts', async () => {
    const editor = setup();
    editor.ref.current!.revealLine(3);
    expect(highlightedLines(editor.container)).toEqual(['type First:']);
    await act(async () => editor.ref.current!.revealPosition({ line: 3, character: 6 }, files[1]!.path));
    expect(highlightedLines(editor.container)).toEqual([]);
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    expect(highlightedLines(editor.container)).toEqual(['type Other:']);
    expect(document.activeElement).toBe(editor.view.contentDOM);
  });

  it('does not reveal a position in the wrong file when the destination is unavailable', () => {
    const editor = setup();
    const focus = vi.spyOn(editor.view.contentDOM, 'focus');
    editor.ref.current!.revealPosition({ line: 3, character: 6 }, '/workspace/missing.rosetta');
    expect(editor.view.state.selection.main.anchor).toBe(0);
    expect(highlightedLines(editor.container)).toEqual([]);
    expect(focus).not.toHaveBeenCalled();
  });

  it('highlights CodeMirror definition navigation, including a repeated destination', () => {
    const editor = setup();
    const anchor = files[0]!.content.indexOf('First');
    editor.view.dispatch({ selection: { anchor }, userEvent: 'select.definition' });
    expect(highlightedLines(editor.container)).toEqual(['type First:']);
    act(() => vi.advanceTimersByTime(600));
    editor.view.dispatch({ selection: { anchor }, userEvent: 'select.definition' });
    act(() => vi.advanceTimersByTime(600));
    expect(highlightedLines(editor.container)).toEqual(['type First:']);
    act(() => vi.advanceTimersByTime(400));
    expect(highlightedLines(editor.container)).toEqual([]);
  });

  it('clears the highlight on a document edit without changing normal editing', () => {
    const editor = setup();
    editor.ref.current!.revealLine(3);
    expect(highlightedLines(editor.container)).toEqual(['type First:']);
    editor.view.dispatch({ changes: { from: 0, insert: '// edit\n' } });
    expect(highlightedLines(editor.container)).toEqual([]);
    expect(editor.onContentChange).toHaveBeenCalledWith(files[0]!.path, '// edit\n' + files[0]!.content);
  });

  it('clears the highlight on an external source update', () => {
    const editor = setup();
    editor.ref.current!.revealLine(3);
    expect(highlightedLines(editor.container)).toEqual(['type First:']);
    editor.rerender(
      <SourceEditor
        ref={editor.ref}
        {...editor.props}
        files={[{ ...files[0]!, content: '// external\n' + files[0]!.content }, files[1]!]}
      />
    );
    expect(highlightedLines(editor.container)).toEqual([]);
    expect(editor.onContentChange).not.toHaveBeenCalled();
  });

  it('clears the highlight for manual cursor placement without highlighting ordinary scrolling', () => {
    const editor = setup();
    editor.ref.current!.revealLine(3);
    expect(highlightedLines(editor.container)).toEqual(['type First:']);
    fireEvent.scroll(editor.view.scrollDOM);
    expect(highlightedLines(editor.container)).toEqual(['type First:']);
    editor.view.dispatch({ selection: { anchor: 0 }, userEvent: 'select.pointer' });
    expect(highlightedLines(editor.container)).toEqual([]);
    fireEvent.scroll(editor.view.scrollDOM);
    expect(highlightedLines(editor.container)).toEqual([]);
  });

  it('lets the host clear a highlight when navigation is cancelled', () => {
    const editor = setup();
    editor.ref.current!.revealLine(3);
    expect(highlightedLines(editor.container)).toEqual(['type First:']);
    editor.ref.current!.clearRevealHighlight?.();
    expect(highlightedLines(editor.container)).toEqual([]);
    act(() => vi.advanceTimersByTime(1000));
    expect(highlightedLines(editor.container)).toEqual([]);
  });

  it('cancels a deferred destination before its navigation frames run', async () => {
    const editor = setup();
    await act(async () => editor.ref.current!.revealPosition({ line: 3, character: 6 }, files[1]!.path));
    editor.ref.current!.clearRevealHighlight?.();
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    expect(highlightedLines(editor.container)).toEqual([]);
    expect(editor.view.state.selection.main.anchor).toBe(0);
    expect(document.activeElement).not.toBe(editor.view.contentDOM);
  });

  it('clears the old highlight on tab changes and does not restore it on returning', () => {
    const editor = setup();
    editor.ref.current!.revealLine(3);
    expect(highlightedLines(editor.container)).toEqual(['type First:']);
    fireEvent.click(screen.getByRole('tab', { name: 'other.rosetta' }));
    expect(highlightedLines(editor.container)).toEqual([]);
    fireEvent.click(screen.getByRole('tab', { name: 'model.rosetta' }));
    expect(highlightedLines(editor.container)).toEqual([]);
  });

  it('cancels its timer before the highlighted view is destroyed', () => {
    const editor = setup();
    editor.ref.current!.revealLine(3);
    expect(highlightedLines(editor.container)).toEqual(['type First:']);
    const dispatch = vi.spyOn(editor.view, 'dispatch');
    editor.unmount();
    act(() => vi.advanceTimersByTime(1000));
    expect(dispatch).not.toHaveBeenCalled();
  });
});
