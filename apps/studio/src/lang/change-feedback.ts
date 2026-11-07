// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { Annotation, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { CHANGE_HIGHLIGHT_MS, CHANGE_REMOVAL_MS, installFeedbackTiming } from '../services/change-feedback.js';
import '../styles/change-feedback.css';

/** Explicitly annotate accepted external updates; typing and initial loads remain quiet. */
export const showChangeFeedback = Annotation.define<boolean>();
const clearFeedback = StateEffect.define<null>();

class RemovedText extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: RemovedText): boolean {
    return other.text === this.text;
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.dataset.changeFeedback = 'remove';
    span.className = 'cm-change-removed';
    span.setAttribute('aria-hidden', 'true');
    span.inert = true;
    span.textContent = this.text.length > 2000 ? `${this.text.slice(0, 2000)}…` : this.text;
    return span;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

export const changeFeedbackDecorations = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(previous, transaction) {
    if (transaction.effects.some((effect) => effect.is(clearFeedback))) return Decoration.none;
    if (!transaction.docChanged) return previous;
    if (!transaction.annotation(showChangeFeedback)) return Decoration.none;
    const ranges: ReturnType<Decoration['range']>[] = [];
    transaction.changes.iterChanges((fromA, toA, fromB, toB) => {
      if (fromB < toB) {
        ranges.push(
          Decoration.mark({ attributes: { 'data-change-feedback': fromA === toA ? 'add' : 'change' } }).range(
            fromB,
            toB
          )
        );
      } else if (fromA < toA) {
        ranges.push(
          Decoration.widget({
            widget: new RemovedText(transaction.startState.doc.sliceString(fromA, toA)),
            side: -1
          }).range(fromB)
        );
      }
    });
    return Decoration.set(ranges, true);
  },
  provide: (field) => EditorView.decorations.from(field)
});

/** Range-local cues share the same effect vocabulary as structured controls. */
export const textChangeFeedback: Extension = [
  changeFeedbackDecorations,
  ViewPlugin.fromClass(
    class {
      private timer: ReturnType<typeof setTimeout> | undefined;
      constructor(view: EditorView) {
        installFeedbackTiming(view.dom);
      }
      update(update: ViewUpdate) {
        const next = update.state.field(changeFeedbackDecorations);
        if (next === update.startState.field(changeFeedbackDecorations)) return;
        clearTimeout(this.timer);
        if (!next.size) return;
        let onlyRemoval = true;
        for (let cursor = next.iter(); cursor.value; cursor.next()) {
          if (!cursor.value.spec.widget) onlyRemoval = false;
        }
        this.timer = setTimeout(
          () => {
            update.view.dispatch({ effects: clearFeedback.of(null) });
          },
          onlyRemoval ? CHANGE_REMOVAL_MS : CHANGE_HIGHLIGHT_MS
        );
      }
      destroy() {
        clearTimeout(this.timer);
      }
    }
  ),
  EditorView.domEventHandlers({
    focus: (_event, view) => {
      view.dispatch({ effects: clearFeedback.of(null) });
      return false;
    }
  }),
  EditorView.theme({
    '.cm-change-removed': {
      display: 'inline-block',
      whiteSpace: 'pre-wrap',
      maxHeight: '8em',
      overflow: 'hidden',
      verticalAlign: 'top',
      pointerEvents: 'none'
    }
  })
];
