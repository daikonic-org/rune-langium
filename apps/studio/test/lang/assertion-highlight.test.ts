// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { javascript } from '@codemirror/lang-javascript';
import { editorExtensions } from '../../src/lang/editor-extensions.js';

let view: EditorView | undefined;
afterEach(() => {
  view?.destroy();
  view = undefined;
  document.body.replaceChildren();
});

it('distinguishes real assertion calls and updates as source changes', () => {
  view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: 'assert(value); assert<boolean>(true); other.assert(false); assertEqual(1); "assert(no)"; // assert(no)',
      extensions: editorExtensions(javascript({ typescript: true }))
    })
  });
  expect([...view.dom.querySelectorAll('.cm-assertion')].map((element) => element.textContent)).toEqual([
    'assert',
    'assert'
  ]);
  view.dispatch({ changes: { from: 0, to: 6, insert: 'verify' } });
  expect(view.dom.querySelectorAll('.cm-assertion')).toHaveLength(1);
});
