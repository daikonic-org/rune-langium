// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import type { EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { withInstrumentation } from '../services/instrumentation/core.js';
import { makeNodeId } from '@rune-langium/visual-editor';

/** Synchronize graph selection only when the cursor lands on a declaration name. */
export const sourceDeclarationAt = withInstrumentation(
  function sourceDeclarationAt(state: EditorState, position: number): string | null {
    const line = state.doc.lineAt(position);
    const declaration = /^(\s*)(type|enum|func|choice|typeAlias|metaType)\s+(\^?[a-zA-Z_][a-zA-Z_0-9]*)\b/.exec(
      line.text
    );
    if (!declaration) return null;
    const name = declaration[3]!;
    const nameFrom = line.from + declaration[0].length - name.length;
    if (position < nameFrom || position > nameFrom + name.length) return null;

    // StreamLanguage supplies lexical context even while the workspace parser is catching up.
    const tree = ensureSyntaxTree(state, line.to);
    const keyword = tree?.resolveInner(line.from + declaration[1]!.length, 1);
    if (keyword?.name !== 'keyword') return null;

    for (let number = line.number; number >= 1; number--) {
      const candidate = state.doc.line(number);
      const namespace = /^(\s*)namespace\s+(?:"([^"]+)"|([\w.]+))/.exec(candidate.text);
      if (!namespace) continue;
      if (tree?.resolveInner(candidate.from + namespace[1]!.length, 1).name !== 'keyword') continue;
      return makeNodeId(
        namespace[2] ?? namespace[3]!,
        name.replace(/^\^/, ''),
        declaration[2] === 'func' ? 'RosettaFunction' : undefined
      );
    }
    return null;
  },
  { op: 'sourceDeclarationAt' }
);
