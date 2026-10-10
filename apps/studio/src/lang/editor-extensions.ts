// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { withInstrumentation } from '../services/instrumentation/core.js';
import { Annotation, EditorState, type ChangeSpec, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { basicSetup, minimalSetup } from 'codemirror';
import { studioEditorExtensions } from './editor-theme.js';

export const externalDocumentChange = Annotation.define<boolean>();

/** Shared chrome and read-only enforcement for source and generated views. */
export const editorExtensions = withInstrumentation(
  function editorExtensions(language: Extension, readOnly = false, chrome: 'full' | 'minimal' = 'full'): Extension[] {
    return [
      EditorState.lineSeparator.of('\n'),
      chrome === 'minimal' ? minimalSetup : basicSetup,
      EditorView.lineWrapping,
      ...studioEditorExtensions,
      language,
      ...(readOnly
        ? [
            EditorState.readOnly.of(true),
            EditorView.editable.of(false),
            EditorView.contentAttributes.of({ tabindex: '0' })
          ]
        : []),
      EditorState.transactionFilter.of((tr) => {
        if (!tr.docChanged || tr.annotation(externalDocumentChange)) return tr;
        if (tr.startState.facet(EditorState.readOnly)) return [];
        if (tr.isUserEvent('undo') || tr.isUserEvent('redo') || !tr.startState.doc.toString().includes('\r\n'))
          return tr;
        const corrections: ChangeSpec[] = [];
        tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
          const text = inserted.toString();
          const splitsCRLF = fromA === toA && tr.startState.doc.sliceString(fromA - 1, fromA + 1) === '\r\n';
          // The raw CR belongs to the existing newline, even when the cursor sits after it.
          if (splitsCRLF) {
            corrections.push({ from: fromB - 1, to: fromB }, { from: toB, insert: '\r' });
          }
          for (let i = 0; i < text.length; i++) {
            if (text[i] === '\n' && text[i - 1] !== '\r') corrections.push({ from: fromB + i, insert: '\r' });
          }
        });
        return corrections.length ? [tr, { changes: corrections, sequential: true }] : tr;
      })
    ];
  },
  { op: 'editorExtensions' }
);
