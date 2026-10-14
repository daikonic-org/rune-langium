// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import type { Locator, Page } from '@playwright/test';

/** The complete file editor, excluding embedded Inspector expression editors. */
export function fullSourceEditor(page: Page) {
  return page.getByTestId('center-stack').locator('[data-pane="source"]').getByTestId('source-editor');
}

/** Read the full document, including lines outside CodeMirror's virtualized viewport. */
export function codeMirrorDocument(editor: Locator) {
  return editor.evaluate((element) => {
    // Mirrors EditorView.findFromDOM: the content Tile's root owns the editor view.
    const content = element.matches('.cm-content') ? element : element.querySelector('.cm-content');
    const tile = (
      content as (HTMLElement & { cmTile?: { root?: { view?: { state: { doc: { toString(): string } } } } } }) | null
    )?.cmTile;
    const view = tile?.root?.view;
    if (view) return view.state.doc.toString();
    throw new Error('CodeMirror document is unavailable.');
  });
}
