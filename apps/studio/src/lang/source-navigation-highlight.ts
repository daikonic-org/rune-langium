// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { withInstrumentation } from '../services/instrumentation/core.js';
import type { SourceRegion } from '@rune-langium/core';

/** A source offset to highlight after navigation, or null to cancel the cue. */
export const setSourceReveal = StateEffect.define<number | null>();

export const setExpressionHighlight = StateEffect.define<SourceRegion | undefined>();
const expressionRange = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(highlight, transaction) {
    for (const effect of transaction.effects) {
      if (!effect.is(setExpressionHighlight)) continue;
      const range = effect.value;
      return range && range.from >= 0 && range.to > range.from && range.to <= transaction.newDoc.length
        ? Decoration.set([Decoration.mark({ class: 'cm-expression-highlight' }).range(range.from, range.to)])
        : Decoration.none;
    }
    return transaction.docChanged ? Decoration.none : highlight;
  },
  provide: (field) => EditorView.decorations.from(field)
});

const revealLine = Decoration.line({ class: 'cm-source-reveal-line' });
const sourceReveal = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(highlight, transaction) {
    if (transaction.docChanged) return Decoration.none;
    let position: number | null | undefined;
    for (const effect of transaction.effects) {
      if (effect.is(setSourceReveal)) position = effect.value;
    }
    if (position === undefined && transaction.isUserEvent('select.definition')) {
      position = transaction.newSelection.main.head;
    }
    if (position === null) return Decoration.none;
    if (position !== undefined) {
      const line = transaction.newDoc.lineAt(position);
      return Decoration.set([revealLine.range(line.from)]);
    }
    return transaction.selection ? Decoration.none : highlight;
  },
  provide: (field) => EditorView.decorations.from(field)
});

export const clearSourceReveal = withInstrumentation(
  function clearSourceReveal(view: EditorView): void {
    if (view.state.field(sourceReveal, false)?.size) {
      view.dispatch({ effects: setSourceReveal.of(null) });
    }
  },
  { op: 'clearSourceReveal' }
);

/** Reveal an expression from a peer pane without moving the source caret. */
export const revealSourceExpression = withInstrumentation(
  function revealSourceExpression(view: EditorView, range?: SourceRegion): void {
    view.dispatch({
      effects: range
        ? [setExpressionHighlight.of(range), EditorView.scrollIntoView(range.from, { y: 'nearest' })]
        : setExpressionHighlight.of(undefined)
    });
  },
  { op: 'revealSourceExpression', capture: 0 }
);

/** One static destination cue per live editor, including CodeMirror LSP jumps. */
export const sourceNavigationHighlight: Extension = [
  sourceReveal,
  expressionRange,
  ViewPlugin.fromClass(
    class {
      private timeout: ReturnType<typeof setTimeout> | undefined;

      update(update: ViewUpdate) {
        const highlight = update.state.field(sourceReveal);
        if (highlight === update.startState.field(sourceReveal)) return;
        clearTimeout(this.timeout);
        this.timeout = undefined;
        if (highlight.size) {
          this.timeout = setTimeout(() => {
            this.timeout = undefined;
            clearSourceReveal(update.view);
          }, 1000);
        }
      }

      destroy() {
        clearTimeout(this.timeout);
      }
    }
  ),
  EditorView.theme({
    '.cm-line.cm-source-reveal-line, .cm-expression-highlight': {
      backgroundColor: 'color-mix(in srgb, var(--primary) 16%, transparent)'
    }
  })
];
