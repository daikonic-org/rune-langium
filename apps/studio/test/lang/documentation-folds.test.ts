// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { foldedRanges, foldEffect } from '@codemirror/language';
import { runeDocumentationFolding, setRuneDocumentationHidden } from '../../src/lang/documentation-folds.js';
import * as language from '../../src/lang/rune-dsl.js';

function folds(state: EditorState) {
  const result: string[] = [];
  foldedRanges(state).between(0, state.doc.length, (from, to) => {
    result.push(state.sliceDoc(from, to));
  });
  return result;
}
const source = 'type First: <"First docs">\n value string (1..1)\n';

it('reconciles new and invalidated documentation folds on edits without changing source bytes', () => {
  let state = EditorState.create({ doc: source, extensions: [runeDocumentationFolding] });
  state = state.update({ effects: setRuneDocumentationHidden.of(true) }).state;
  expect(folds(state)).toEqual(['<"First docs">']);
  const added = "type Second:\n < 'Second docs' >\n value string (1..1)\n";
  state = state.update({ changes: { from: state.doc.length, insert: added } }).state;
  expect(folds(state)).toEqual(['<"First docs">', "< 'Second docs' >"]);
  const open = state.doc.toString().indexOf('<"');
  state = state.update({ changes: { from: open, to: open + 1, insert: ' ' } }).state;
  expect(folds(state)).toEqual(["< 'Second docs' >"]);
  const expected = state.doc.toString();
  state = state.update({ effects: setRuneDocumentationHidden.of(false) }).state;
  expect(folds(state)).toEqual([]);
  expect(state.doc.toString()).toBe(expected);
});

it('retains unrelated user folds when documentation is shown again', () => {
  const text = source + 'type Other:\n value string (1..1)\n';
  let state = EditorState.create({ doc: text, extensions: [runeDocumentationFolding] });
  const manual = { from: text.indexOf('type Other'), to: text.length - 1 };
  state = state.update({ effects: foldEffect.of(manual) }).state;
  state = state.update({ effects: setRuneDocumentationHidden.of(true) }).state;
  state = state.update({ changes: { from: 0, insert: '// prefix\n' } }).state;
  state = state.update({ effects: setRuneDocumentationHidden.of(false) }).state;
  expect(folds(state)).toEqual([text.slice(manual.from, manual.to)]);
});

it('does not scan visible documents on ordinary edits', () => {
  const scan = vi.spyOn(language, 'runeDocumentationRanges');
  try {
    const state = EditorState.create({ doc: source, extensions: [runeDocumentationFolding] });
    state.update({ changes: { from: 0, insert: '// prefix\n' } });
    expect(scan).not.toHaveBeenCalled();
  } finally {
    scan.mockRestore();
  }
});
