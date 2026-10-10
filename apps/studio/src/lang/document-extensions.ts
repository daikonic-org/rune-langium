// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { EditorState, StateEffect, StateField, Transaction, type Extension, type ChangeSpec } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import type { SourceRegion } from '@rune-langium/core';
import { runeDslLanguage } from './rune-dsl.js';
import { editorExtensions, externalDocumentChange } from './editor-extensions.js';
import { withInstrumentation } from '../services/instrumentation/core.js';

export { externalDocumentChange } from './editor-extensions.js';
export const setProtectedRegion = StateEffect.define<SourceRegion>();
export const protectedRegion = StateField.define<SourceRegion>({
  create: (state) => ({ from: 0, to: state.doc.length }),
  update(region, tr) {
    for (const effect of tr.effects) if (effect.is(setProtectedRegion)) return effect.value;
    return { from: tr.changes.mapPos(region.from, -1), to: tr.changes.mapPos(region.to, 1) };
  },
  provide: (field) =>
    EditorView.decorations.compute([field], (state) => {
      const { from, to } = state.field(field);
      const ranges = [];
      if (from > 0) ranges.push(Decoration.replace({}).range(0, from));
      if (to < state.doc.length) ranges.push(Decoration.replace({}).range(to, state.doc.length));
      return Decoration.set(ranges);
    })
});

export const documentExtensions = withInstrumentation(
  function documentExtensions(region?: SourceRegion): Extension[] {
    const extensions = editorExtensions(runeDslLanguage(), false, region ? 'minimal' : 'full');
    if (region) {
      extensions.push(
        protectedRegion.init(() => region),
        EditorState.transactionFilter.of((tr) => {
          if (tr.annotation(externalDocumentChange)) return tr;
          const bounds = tr.startState.field(protectedRegion);
          let outside = false;
          tr.changes.iterChangedRanges((from, to) => {
            if (from < bounds.from || to > bounds.to) outside = true;
          });
          if (outside) return [];
          // The empty body begins after the signature's final token, before its newline.
          if (tr.docChanged && bounds.from === bounds.to && tr.startState.doc.lineAt(bounds.from).from < bounds.from) {
            const inserted = tr.newDoc.sliceString(bounds.from, tr.changes.mapPos(bounds.to, 1));
            if (inserted && !inserted.startsWith('\n') && !inserted.startsWith('\r\n')) {
              const newline = tr.startState.doc.toString().includes('\r\n') ? '\r\n' : '\n';
              return tr.startState.update({
                changes: { from: bounds.from, insert: newline + inserted },
                selection: {
                  anchor: tr.newSelection.main.anchor + newline.length,
                  head: tr.newSelection.main.head + newline.length
                },
                userEvent: tr.annotation(Transaction.userEvent),
                filter: false
              });
            }
          }
          const nextBounds = tr.state.field(protectedRegion);
          const selection = tr.newSelection.main;
          const clamp = (position: number) => Math.max(nextBounds.from, Math.min(nextBounds.to, position));
          if (
            selection.anchor < nextBounds.from ||
            selection.anchor > nextBounds.to ||
            selection.head < nextBounds.from ||
            selection.head > nextBounds.to
          ) {
            return [tr, { selection: { anchor: clamp(selection.anchor), head: clamp(selection.head) } }];
          }
          return tr;
        })
      );
    }
    return extensions;
  },
  { op: 'documentExtensions' }
);

export const minimalDocumentChange = withInstrumentation(
  function minimalDocumentChange(before: string, after: string): ChangeSpec {
    let from = 0;
    while (from < before.length && from < after.length && before[from] === after[from]) from++;
    let oldEnd = before.length;
    let newEnd = after.length;
    while (oldEnd > from && newEnd > from && before[oldEnd - 1] === after[newEnd - 1]) {
      oldEnd--;
      newEnd--;
    }
    return { from, to: oldEnd, insert: after.slice(from, newEnd) };
  },
  { op: 'minimalDocumentChange' }
);
