// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { describe, it, expect, vi } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EditorView } from '@codemirror/view';
import { RuneRegionEditor } from '../../src/components/editing/RuneRegionEditor.js';
import { SourceEditor } from '../../src/components/SourceEditor.js';
import { parse, getFunctionImplementationRegion, type RosettaFunction } from '@rune-langium/core';
import { EditorState, Transaction } from '@codemirror/state';
import { insertNewline, undo, redo } from '@codemirror/commands';
import {
  documentExtensions,
  protectedRegion,
  externalDocumentChange,
  minimalDocumentChange
} from '../../src/lang/document-extensions.js';

const header = 'namespace test.regions\nfunc Calculate:\n  output: result int (1..1)\n';
const body = '  alias increment: 1\n  set result: increment';
const suffix = '\nfunc Neighbor:\n  set answer: 7';
const source = header + body + suffix;
const region = { from: header.length, to: header.length + body.length };

function document() {
  return EditorState.create({
    doc: source,
    selection: { anchor: region.from },
    extensions: documentExtensions(region)
  });
}

describe('full-file protected Rune editing', () => {
  it.each(['\n', '\r\n'])('hides common body indentation without changing source bytes (%j)', (newline) => {
    const body = ['  set result: Quote {', '    amount: value * 2,', '    currency: "USD"', '  }'].join(newline);
    const fullSource = header + body + suffix;
    const state = EditorState.create({
      doc: fullSource,
      extensions: documentExtensions({ from: header.length, to: header.length + body.length })
    });
    const view = new EditorView({ state, parent: globalThis.document.createElement('div') });
    try {
      expect(Array.from(view.contentDOM.querySelectorAll('.cm-line'), (line) => line.textContent)).toEqual(
        ['set result: Quote {', '  amount: value * 2,', '  currency: "USD"', '}'].map(
          (line, index) => line + (newline === '\r\n' && index < 3 ? '\u240d' : '')
        )
      );
      expect(view.state.doc.toString()).toBe(fullSource);
      const from = fullSource.indexOf('value * 2');
      view.dispatch({ changes: { from, to: from + 'value * 2'.length, insert: 'value * 3' } });
      expect(view.state.doc.toString()).toBe(fullSource.replace('value * 2', 'value * 3'));
    } finally {
      view.destroy();
    }
  });

  it('retains the whole document while protecting the signature and neighbor', () => {
    const state = document();
    expect(state.doc.toString()).toBe(source);
    expect(state.update({ changes: { from: 0, insert: 'broken' } }).state.doc.toString()).toBe(source);
    expect(state.update({ changes: { from: region.to, to: source.length, insert: '' } }).state.doc.toString()).toBe(
      source
    );
    expect(
      state.update({ changes: { from: region.from - 1, to: region.to, insert: 'broken' } }).state.doc.toString()
    ).toBe(source);
  });

  it('supports a continuous paste, mapped ranges and one undo entry', () => {
    let state = document();
    const replacement =
      '  alias next: 2\n  condition Good: next > 0\n  set result: next\n  post-condition Done: result > 0';
    state = state.update({ changes: { ...region, insert: replacement } }).state;
    expect(state.doc.toString()).toBe(header + replacement + suffix);
    expect(state.field(protectedRegion)).toEqual({ from: region.from, to: region.from + replacement.length });
    const target = {
      get state() {
        return state;
      },
      dispatch: (tr: Transaction) => {
        state = tr.state;
      }
    };
    expect(undo(target)).toBe(true);
    expect(state.doc.toString()).toBe(source);
    expect(redo(target)).toBe(true);
    expect(state.doc.toString()).toBe(header + replacement + suffix);
  });

  it('maps regions after external changes without adding external text to undo history', () => {
    let state = document();
    const external = '// source change\n' + source;
    state = state.update({
      changes: minimalDocumentChange(source, external),
      annotations: [externalDocumentChange.of(true), Transaction.addToHistory.of(false)]
    }).state;
    const updated = state.field(protectedRegion);
    expect(updated.from).toBe(region.from + '// source change\n'.length);
    expect(state.update({ changes: { from: updated.from, insert: '  // local\n' } }).state.doc.toString()).toContain(
      '// local'
    );
    const target = {
      get state() {
        return state;
      },
      dispatch: (tr: Transaction) => {
        state = tr.state;
      }
    };
    expect(undo(target)).toBe(false);
  });

  it('retains invalid text without reparsing or rebuilding the source', () => {
    const invalid = '  set result: if (';
    const state = document().update({ changes: { ...region, insert: invalid } }).state;
    expect(state.doc.toString()).toBe(header + invalid + suffix);
  });
});

describe('real region editor', () => {
  it('keeps ten original fixture operations in one full-file view and synchronizes Source', async () => {
    const source = readFileSync(
      resolve(process.cwd(), '../../packages/visual-editor/test/fixtures/function-multi-operation.rosetta'),
      'utf8'
    );
    const parsed = await parse(source);
    const func = parsed.value.elements.find((e) => e.$type === 'RosettaFunction') as RosettaFunction;
    const region = getFunctionImplementationRegion(func, source);
    let inspector: EditorView | undefined;
    let full: EditorView | undefined;
    const change = vi.fn();
    const binding = {
      uri: 'file:///corpus.rosetta',
      nodeId: 'test.operations.Summarize',
      workspaceGeneration: 1,
      revision: 1,
      source,
      region,
      readOnly: false
    };
    const sourceProps = {
      files: [{ name: 'corpus.rosetta', path: '/corpus.rosetta', content: source, dirty: false }],
      onEditorViewCreated: (_: string, view: EditorView) => {
        full = view;
      }
    };
    const host = render(
      <>
        <SourceEditor {...sourceProps} />
        <RuneRegionEditor
          binding={binding}
          path="/corpus.rosetta"
          source={source}
          onContentChange={change}
          onViewCreated={(v) => {
            inspector = v;
          }}
        />
      </>
    );
    expect(host.getAllByTestId('implementation-editor')).toHaveLength(1);
    expect(inspector!.state.doc.toString()).toBe(source);
    expect(inspector!.state.doc.toString()).toContain('alias totalValue:');
    expect(func.operations).toHaveLength(10);
    const insert = '  // draft retained even while invalid\n';
    act(() => inspector!.dispatch({ changes: { from: region.from, insert } }));
    const updated = inspector!.state.doc.toString();
    expect(change).toHaveBeenLastCalledWith('/corpus.rosetta', updated);
    host.rerender(
      <>
        <SourceEditor {...sourceProps} files={[{ ...sourceProps.files[0]!, content: updated }]} />
        <RuneRegionEditor
          binding={binding}
          path="/corpus.rosetta"
          source={updated}
          onContentChange={change}
          onViewCreated={(v) => {
            inspector = v;
          }}
        />
      </>
    );
    expect(full!.state.doc.toString()).toBe(updated);
    expect(change).toHaveBeenCalledTimes(1);
    expect(new Set(Array.from(host.container.querySelectorAll('[id]'), (e) => e.id)).size).toBe(
      host.container.querySelectorAll('[id]').length
    );
    act(() => undo(inspector!));
    expect(inspector!.state.doc.toString()).toBe(source);
    act(() => redo(inspector!));
    expect(inspector!.state.doc.toString()).toBe(updated);
    host.unmount();
    expect(change).toHaveBeenLastCalledWith('/corpus.rosetta', updated);
    cleanup();
  });

  it('inserts an empty implementation on its own line and protects the neighboring function', () => {
    const header = 'namespace test\nfunc Empty:\n  output: result int (1..1)';
    const source = header + '\n\nfunc Neighbor:\n  set value: 7';
    const region = { from: header.length, to: header.length };
    let state = EditorState.create({ doc: source, extensions: documentExtensions(region) });
    state = state.update({ changes: { from: region.from, insert: '  set result: 42' } }).state;
    expect(state.doc.toString()).toBe(header + '\n  set result: 42\n\nfunc Neighbor:\n  set value: 7');
  });

  it('retains CRLF bytes and their full-file offsets', () => {
    const source = 'namespace test\r\nfunc F:\r\n  set value: 1\r\n';
    const from = source.indexOf('  set');
    const state = EditorState.create({ doc: source, extensions: documentExtensions({ from, to: source.length }) });
    expect(state.doc.toString()).toBe(source);
    expect(
      state
        .update({ changes: { from: source.indexOf('1'), to: source.indexOf('1') + 1, insert: '42' } })
        .state.doc.toString()
    ).toBe(source.replace('1', '42'));
  });

  it.each([false, true])('keeps Enter, paste and undo consistently CRLF (protected: %s)', (protectedBody) => {
    const source = 'namespace test\r\nfunc F:\r\n  set value: 1\r\n';
    const from = source.indexOf('  set');
    let state = EditorState.create({
      doc: source,
      extensions: documentExtensions(protectedBody ? { from, to: source.length } : undefined)
    });
    // CodeMirror's line end is after the retained CR, immediately before the LF.
    state = state.update({ selection: { anchor: state.doc.lineAt(source.indexOf('1')).to } }).state;
    const target = {
      get state() {
        return state;
      },
      dispatch: (tr: Transaction) => {
        state = tr.state;
      }
    };
    expect(insertNewline(target)).toBe(true);
    const entered = source + '\r\n';
    expect(state.doc.toString()).toBe(entered);
    if (protectedBody) expect(state.field(protectedRegion)).toEqual({ from, to: entered.length });
    expect(undo(target)).toBe(true);
    expect(state.doc.toString()).toBe(source);
    expect(redo(target)).toBe(true);
    expect(state.doc.toString()).toBe(entered);
    state = state.update({ changes: { from, insert: '  alias a: 1\n  alias b: 2\r\n' } }).state;
    expect(state.doc.toString()).toBe(
      entered.slice(0, from) + '  alias a: 1\r\n  alias b: 2\r\n' + entered.slice(from)
    );
  });
});
