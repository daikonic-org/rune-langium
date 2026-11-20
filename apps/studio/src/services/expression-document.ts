// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import type { SourceRegion } from '@rune-langium/core';
import { isolateHistory } from '@codemirror/commands';
import { ChangeSet } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { minimalDocumentChange } from '../lang/document-extensions.js';
import { withInstrumentation } from './instrumentation/core.js';

export type DocumentBinding = Readonly<{
  workspaceGeneration: number;
  uri: string;
  nodeId: string;
  revision: number;
  source: string;
  region: SourceRegion;
  readOnly: boolean;
}>;
export type DocumentEdit = Readonly<{
  binding: DocumentBinding;
  region: SourceRegion;
  expectedText: string;
  replacement: string;
}>;
export type CommitResult =
  | { ok: true }
  | { ok: false; reason: 'stale' | 'read-only' | 'missing-source' | 'invalid-range' };
export interface ExpressionDocumentFile {
  path: string;
  content: string;
  readOnly?: boolean;
  sourceLoaded?: boolean;
}
interface DocumentOptions {
  getGeneration(): number;
  getFile(uri: string): ExpressionDocumentFile | undefined;
  onContentChange(path: string, content: string): void;
}

function validRegion(region: SourceRegion, length: number): boolean {
  return (
    Number.isInteger(region.from) &&
    Number.isInteger(region.to) &&
    region.from >= 0 &&
    region.to >= region.from &&
    region.to <= length
  );
}

/** Revision checks protect captured drafts; the workspace remains the source owner. */
export class ExpressionDocument {
  private revision = 0;
  private snapshots = new Map<string, { generation: number; source: string; revision: number }>();
  private regions = new Map<string, DocumentBinding>();

  constructor(private options: DocumentOptions) {}

  /** Observe every workspace change, including edits later undone to identical text. */
  observe(uri: string): void {
    if (!this.options.getFile(uri)) {
      for (const [key, binding] of this.regions) if (binding.uri === uri) this.regions.delete(key);
      this.snapshots.delete(uri);
    }
    this.capture(uri, '', { from: 0, to: 0 });
  }

  retainRegion(binding: DocumentBinding, target: string, source = binding.source, region = binding.region): void {
    if (binding.workspaceGeneration !== this.options.getGeneration() || !validRegion(region, source.length)) return;
    this.regions.set(JSON.stringify([binding.uri, binding.nodeId, target]), { ...binding, source, region });
  }

  /** Recover only edits inside the known region; changed identity/signatures need a fresh parse. */
  recoverRegion(uri: string, nodeId: string, target: string): DocumentBinding | null {
    const key = JSON.stringify([uri, nodeId, target]);
    const binding = this.regions.get(key);
    const file = this.options.getFile(uri);
    if (!binding || !file || binding.workspaceGeneration !== this.options.getGeneration()) {
      this.regions.delete(key);
      return null;
    }
    const changes = ChangeSet.of(minimalDocumentChange(binding.source, file.content), binding.source.length);
    let outside = false;
    changes.iterChangedRanges((from, to) => {
      if (from < binding.region.from || to > binding.region.to) outside = true;
    });
    if (outside) {
      this.regions.delete(key);
      return null;
    }
    const region = { from: changes.mapPos(binding.region.from, -1), to: changes.mapPos(binding.region.to, 1) };
    const current = this.capture(uri, nodeId, region);
    if (current) this.retainRegion(current, target);
    return current;
  }

  capture(uri: string, nodeId: string, region: SourceRegion): DocumentBinding | null {
    const file = this.options.getFile(uri);
    if (!file || file.sourceLoaded === false || !validRegion(region, file.content.length)) return null;
    const generation = this.options.getGeneration();
    let snapshot = this.snapshots.get(uri);
    if (!snapshot || snapshot.generation !== generation || snapshot.source !== file.content) {
      snapshot = { generation, source: file.content, revision: ++this.revision };
      this.snapshots.set(uri, snapshot);
    }
    return {
      workspaceGeneration: generation,
      uri,
      nodeId,
      region,
      revision: snapshot.revision,
      source: snapshot.source,
      readOnly: Boolean(file.readOnly)
    };
  }

  applyDocumentEdit(
    { binding, region, expectedText, replacement }: DocumentEdit,
    commit: (path: string, content: string) => void | false = this.options.onContentChange
  ): CommitResult {
    const file = this.options.getFile(binding.uri);
    if (!file || file.sourceLoaded === false) return { ok: false, reason: 'missing-source' };
    if (binding.readOnly || file.readOnly) return { ok: false, reason: 'read-only' };
    if (!validRegion(region, file.content.length) || region.from < binding.region.from || region.to > binding.region.to)
      return { ok: false, reason: 'invalid-range' };
    const current = this.capture(binding.uri, binding.nodeId, binding.region);
    if (
      !current ||
      current.workspaceGeneration !== binding.workspaceGeneration ||
      current.revision !== binding.revision ||
      file.content.slice(region.from, region.to) !== expectedText
    )
      return { ok: false, reason: 'stale' };
    const content = file.content.slice(0, region.from) + replacement + file.content.slice(region.to);
    if (content !== file.content && commit(file.path, content) === false) return { ok: false, reason: 'invalid-range' };
    return { ok: true };
  }
}

/** Apply through the owning editor so publishing and undo use the same transaction. */
export const applyExpressionDocumentEdit = withInstrumentation(
  function applyExpressionDocumentEdit(
    documents: ExpressionDocument,
    view: EditorView,
    edit: DocumentEdit
  ): CommitResult {
    if (view.state.readOnly) return { ok: false, reason: 'read-only' };
    if (view.state.doc.toString() !== edit.binding.source) return { ok: false, reason: 'stale' };
    return documents.applyDocumentEdit(edit, (_, content) => {
      const transaction = view.state.update({
        changes: minimalDocumentChange(edit.binding.source, content),
        annotations: isolateHistory.of('full'),
        userEvent: 'input.expression'
      });
      if (transaction.newDoc.toString() !== content) return false;
      view.dispatch(transaction);
    });
  },
  { op: 'applyExpressionDocumentEdit', capture: 0 }
);
