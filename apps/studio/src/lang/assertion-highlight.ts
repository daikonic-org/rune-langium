// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { syntaxTree } from '@codemirror/language';
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view';
import type { Range } from '@codemirror/state';

const assertion = Decoration.mark({ class: 'cm-assertion' });

/** Style assertion callees, never matching strings, comments or member names. */
function assertionMarks(view: EditorView): DecorationSet {
  const marks: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        if (node.name !== 'CallExpression') return;
        const expression = node.node.firstChild;
        const callee = expression?.name === 'InstantiationExpression' ? expression.firstChild : expression;
        if (
          callee?.name === 'VariableName' &&
          callee.from >= from &&
          callee.to <= to &&
          view.state.sliceDoc(callee.from, callee.to) === 'assert'
        )
          marks.push(assertion.range(callee.from, callee.to));
      }
    });
  }
  return Decoration.set(marks, true);
}

export const assertionHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = assertionMarks(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state))
        this.decorations = assertionMarks(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations }
);
