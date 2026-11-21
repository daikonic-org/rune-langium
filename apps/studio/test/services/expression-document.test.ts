// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undo } from '@codemirror/commands';
import {
  applyExpressionDocumentEdit,
  ExpressionDocument,
  type ExpressionDocumentFile
} from '../../src/services/expression-document.js';

function workspace() {
  let generation = 1;
  const files = new Map<string, ExpressionDocumentFile>([
    ['file:///first.rosetta', { path: '/first.rosetta', content: 'prefix 1 + 2 suffix' }],
    ['file:///second.rosetta', { path: '/second.rosetta', content: 'same namespace, separate file' }]
  ]);
  const writes: { path: string; content: string }[] = [];
  const documents = new ExpressionDocument({
    getGeneration: () => generation,
    getFile: (uri) => files.get(uri),
    onContentChange: (path, content) => {
      writes.push({ path, content });
      const [uri, file] = [...files].find(([, f]) => f.path === path)!;
      files.set(uri, { ...file, content });
    }
  });
  const binding = documents.capture('file:///first.rosetta', 'ns.Calculate', { from: 7, to: 12 })!;
  const edit = { binding, region: binding.region, expectedText: '1 + 2', replacement: '42' };
  return { documents, files, writes, edit, switchWorkspace: () => generation++ };
}

describe('expression document ownership', () => {
  it('applies one isolated edit to the captured CRLF occurrence', () => {
    const { documents, files } = workspace();
    const uri = 'file:///first.rosetta';
    const original = 'namespace shared\r\n// 😀\r\nset value: 1 + 2\r\n';
    files.set(uri, { path: '/first.rosetta', content: original });
    const from = original.indexOf('1 + 2');
    const region = { from, to: from + 5 };
    const binding = documents.capture(uri, 'shared.Calculate', region)!;
    const published: string[] = [];
    const view = new EditorView({
      state: EditorState.create({
        doc: original,
        extensions: [
          EditorState.lineSeparator.of('\n'),
          history(),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) published.push(update.state.doc.toString());
          })
        ]
      })
    });
    try {
      expect(
        applyExpressionDocumentEdit(documents, view, { binding, region, expectedText: '1 + 2', replacement: '42' })
      ).toEqual({ ok: true });
      expect(published).toEqual(['namespace shared\r\n// 😀\r\nset value: 42\r\n']);
      expect(files.get('file:///second.rosetta')!.content).toBe('same namespace, separate file');
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(original);
    } finally {
      view.destroy();
    }
  });

  it('does not report success when the source editor refuses a transaction', () => {
    const { documents, edit, writes } = workspace();
    const view = new EditorView({
      state: EditorState.create({
        doc: edit.binding.source,
        extensions: EditorState.transactionFilter.of(() => [])
      })
    });
    try {
      expect(applyExpressionDocumentEdit(documents, view, edit)).toEqual({ ok: false, reason: 'invalid-range' });
      expect(view.state.doc.toString()).toBe(edit.binding.source);
      expect(writes).toEqual([]);
    } finally {
      view.destroy();
    }
  });

  it('recovers mapped body drafts and rejects changed identity or workspace generation', () => {
    const { documents, files, edit, switchWorkspace } = workspace();
    documents.retainRegion(edit.binding, 'implementation');
    files.set(edit.binding.uri, { path: '/first.rosetta', content: 'prefix if ( suffix' });
    const recovered = documents.recoverRegion(edit.binding.uri, edit.binding.nodeId, 'implementation')!;
    expect(recovered.source.slice(recovered.region.from, recovered.region.to)).toBe('if (');
    expect(documents.recoverRegion(edit.binding.uri, 'other-node', 'implementation')).toBeNull();
    expect(documents.recoverRegion(edit.binding.uri, edit.binding.nodeId, 'condition:0')).toBeNull();
    files.set(edit.binding.uri, { path: '/first.rosetta', content: 'renamed if ( suffix' });
    expect(documents.recoverRegion(edit.binding.uri, edit.binding.nodeId, 'implementation')).toBeNull();
    files.set(edit.binding.uri, { path: '/first.rosetta', content: edit.binding.source });
    documents.retainRegion(edit.binding, 'implementation');
    switchWorkspace();
    expect(documents.recoverRegion(edit.binding.uri, edit.binding.nodeId, 'implementation')).toBeNull();
  });
  it('changes only the captured range in its owning file', () => {
    const { documents, files, writes, edit } = workspace();
    expect(documents.applyDocumentEdit(edit)).toEqual({ ok: true });
    expect(writes).toEqual([{ path: '/first.rosetta', content: 'prefix 42 suffix' }]);
    expect(files.get('file:///second.rosetta')!.content).toBe('same namespace, separate file');
  });

  it.each(['source', 'workspace', 'expected-text', 'undo-to-same-text'])(
    'rejects stale %s without writing',
    (reason) => {
      const { documents, files, writes, edit, switchWorkspace } = workspace();
      if (reason === 'workspace') switchWorkspace();
      else if (reason === 'expected-text') edit.expectedText = 'stale';
      else {
        files.set(edit.binding.uri, { ...files.get(edit.binding.uri)!, content: 'prefix 3 + 4 suffix' });
        if (reason === 'undo-to-same-text') {
          documents.capture(edit.binding.uri, edit.binding.nodeId, edit.binding.region);
          files.set(edit.binding.uri, { ...files.get(edit.binding.uri)!, content: edit.binding.source });
        }
      }
      expect(documents.applyDocumentEdit(edit)).toEqual({ ok: false, reason: 'stale' });
      expect(writes).toHaveLength(0);
    }
  );

  it.each(['read-only', 'missing-source', 'invalid-range'] as const)('rejects %s without writing', (reason) => {
    const { documents, files, writes, edit } = workspace();
    if (reason === 'read-only') files.set(edit.binding.uri, { ...files.get(edit.binding.uri)!, readOnly: true });
    if (reason === 'missing-source') files.delete(edit.binding.uri);
    if (reason === 'invalid-range') edit.region = { from: 0, to: 12 };
    expect(documents.applyDocumentEdit(edit)).toEqual({ ok: false, reason });
    expect(writes).toHaveLength(0);
  });

  it('does not turn unhydrated curated source into an empty writable binding', () => {
    const { documents, files } = workspace();
    files.set('file:///curated.rosetta', {
      path: '/curated.rosetta',
      content: '',
      readOnly: true,
      sourceLoaded: false
    });
    expect(documents.capture('file:///curated.rosetta', 'ns.Type', { from: 0, to: 0 })).toBeNull();
  });
});
