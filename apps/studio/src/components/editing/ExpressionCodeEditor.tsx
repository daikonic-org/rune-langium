// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { javascript } from '@codemirror/lang-javascript';
import { editorExtensions, externalDocumentChange } from '../../lang/editor-extensions.js';
import { withInstrumentation } from '../../services/instrumentation/core.js';

interface CodeEditorProps {
  language: 'typescript' | 'python';
  code: string;
  readOnly: boolean;
  label: string;
  onChange?(code: string): void;
}
export const ExpressionCodeEditor = withInstrumentation(
  function ExpressionCodeEditor({ language, code, readOnly, label, onChange }: CodeEditorProps) {
    const parent = useRef<HTMLDivElement>(null);
    const view = useRef<EditorView>(null);
    const changed = useRef(onChange);
    changed.current = onChange;
    useEffect(() => {
      if (!parent.current) return;
      const editor = new EditorView({
        parent: parent.current,
        state: EditorState.create({
          doc: code,
          extensions: [
            ...editorExtensions(language === 'typescript' ? javascript({ typescript: true }) : [], readOnly, 'minimal'),
            EditorView.contentAttributes.of({ 'aria-label': label }),
            EditorView.updateListener.of((update) => {
              if (update.docChanged && !update.transactions.some((tr) => tr.annotation(externalDocumentChange)))
                changed.current?.(update.state.doc.toString());
            })
          ]
        })
      });
      view.current = editor;
      return () => {
        editor.destroy();
        view.current = null;
      };
    }, [language, readOnly, label]);
    useEffect(() => {
      const editor = view.current;
      if (editor && editor.state.doc.toString() !== code)
        editor.dispatch({
          changes: { from: 0, to: editor.state.doc.length, insert: code },
          annotations: externalDocumentChange.of(true)
        });
    }, [code]);
    return (
      <div
        ref={parent}
        className="min-h-32 h-[var(--expression-editor-height,20rem)] resize-y overflow-hidden rounded-sm border border-border"
      />
    );
  },
  { op: 'ExpressionCodeEditor' }
);
