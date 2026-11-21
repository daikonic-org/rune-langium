// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Daikonic contributors

import { useCallback, useState, type ReactNode } from 'react';
import {
  parseExpressionDraft,
  type ExpressionPickerTarget,
  type ExpressionRow,
  type SourceRegion
} from '@rune-langium/core';
import { ExpressionBuilder, useLatestRef, type ExpressionSlot, type FunctionScope } from '@rune-langium/visual-editor';
import { Button } from '@rune-langium/design-system/ui/button';
import { SourceEditor } from '../SourceEditor.js';
import { requestExpressionPickerContext, type WorkspaceFile } from '../../services/workspace.js';
import type { DocumentBinding, ExpressionDocument } from '../../services/expression-document.js';
import { withInstrumentation } from '../../services/instrumentation/core.js';

const emptyScope: FunctionScope = { inputs: [], aliases: [], output: null };
const draftPath = '/expression-draft.rosetta';

export type InlineExpressionSession = {
  binding: DocumentBinding;
  documents: ExpressionDocument;
  file: WorkspaceFile;
  files: readonly WorkspaceFile[];
  scope?: FunctionScope;
};

type InlineExpressionFieldProps = {
  compositionArgumentNames?: readonly string[];
  session: InlineExpressionSession;
  target: ExpressionPickerTarget;
  editable?: boolean;
  value: string;
  onChange(value: string): void;
  onActiveSlot?(slot: ExpressionSlot | undefined): void;
  onEditingChange?(editing: boolean): void;
  onHighlightRange?(range: SourceRegion | undefined): void;
  highlightedRange?: SourceRegion;
};

export const InlineExpressionField = withInstrumentation(
  function InlineExpressionField({
    compositionArgumentNames,
    session,
    target,
    editable = true,
    value,
    onChange,
    onActiveSlot,
    onEditingChange,
    onHighlightRange,
    highlightedRange
  }: InlineExpressionFieldProps) {
    const { binding, documents, file, files, scope } = session;
    const current = useLatestRef({ value, files, binding, editable });
    const isCurrent = useCallback(() => {
      const latest = documents.capture(binding.uri, binding.nodeId, binding.region);
      return (
        current.current.editable &&
        latest?.workspaceGeneration === binding.workspaceGeneration &&
        latest.revision === binding.revision &&
        !latest.readOnly &&
        current.current.binding.uri === binding.uri &&
        current.current.binding.nodeId === binding.nodeId &&
        current.current.files === files &&
        current.current.value === value
      );
    }, [binding, current, documents, files, value]);
    const loadPicker = useCallback(
      async (address: ExpressionPickerTarget, trail: readonly string[]) => {
        if (!isCurrent()) throw new Error('The source changed. Reopen this expression.');
        let candidateSource: string | undefined;
        if ('root' in address && 'root' in target) {
          const { from, to } = target.root;
          if (binding.source.slice(from, to) !== value) {
            // Empty is a valid, same-width stand-in for a draft argument hole.
            // It exists only in the worker's private candidate.
            const { candidate, parsed } = parseExpressionDraft(value);
            if (parsed.hasErrors) {
              address = target;
            } else candidateSource = binding.source.slice(0, from) + candidate + binding.source.slice(to);
          }
        }
        const result = await requestExpressionPickerContext(
          file.path,
          binding.nodeId,
          {
            target: address,
            trail,
            candidateSource,
            draftSource: 'draftAddress' in address && address.draftAddress ? value : undefined
          },
          files
        );
        if (!isCurrent()) throw new Error('The source changed. Reopen this expression.');
        return result;
      },
      [binding, file.path, files, isCurrent, target, value]
    );
    return (
      <ExpressionBuilder
        value={value}
        presentation="inline"
        compositionArgumentNames={compositionArgumentNames}
        onChange={onChange}
        onBlur={() => {}}
        onActiveSlot={onActiveSlot}
        onEditingChange={onEditingChange}
        onHighlightRange={onHighlightRange}
        highlightedRange={highlightedRange}
        sourceTarget={target}
        loadPicker={loadPicker}
        canCommit={isCurrent}
        scope={scope ?? emptyScope}
        renderTextEditor={({ value, onChange: change }) => (
          <div className="expression-code-editor w-full min-w-0">
            <SourceEditor
              hideTabs
              activeFile={draftPath}
              files={[{ path: draftPath, name: 'Rune expression', content: value, dirty: false }]}
              onContentChange={(_, text) => change(text)}
            />
          </div>
        )}
      />
    );
  },
  { op: 'InlineExpressionField', capture: 0 }
);

function expressionRowTarget(row: ExpressionRow): ExpressionPickerTarget {
  return { root: row.region, path: '', range: row.region };
}

type ExpressionRowDraft = {
  region: SourceRegion;
  text: string;
  argumentNames?: readonly string[];
  alias?: { name: string; onRename(name: string): void };
};

export const InlineExpressionRows = withInstrumentation(
  function InlineExpressionRows({
    session,
    rows,
    draft,
    onChange,
    onAdd,
    onApply,
    onDiscard,
    onActiveSlot,
    onEditingChange,
    onHighlightRange,
    highlightedRange,
    pending,
    editable,
    invalid,
    showStatement = true,
    after
  }: {
    session: InlineExpressionSession;
    rows: readonly ExpressionRow[];
    draft?: ExpressionRowDraft;
    onChange(row: ExpressionRow | undefined, text: string): void;
    onAdd?(): void;
    onApply(): void;
    onDiscard(): void;
    onActiveSlot?(slot: ExpressionSlot | undefined): void;
    onEditingChange?(editing: boolean): void;
    onHighlightRange?(range: SourceRegion | undefined): void;
    highlightedRange?: SourceRegion;
    pending: boolean;
    editable: boolean;
    invalid?: boolean;
    showStatement?: boolean;
    after?: ReactNode;
  }) {
    const [editingRow, setEditingRow] = useState<string>();
    const editing = editingRow !== undefined;
    const updateEditingRow = (row: string | undefined) => {
      setEditingRow(row);
      onEditingChange?.(row !== undefined);
    };
    const source = session.binding.source;
    const sameRegion = (region: SourceRegion) => draft?.region.from === region.from && draft?.region.to === region.to;
    const controls = (
      <div className="flex flex-wrap items-center gap-1">
        <Button size="sm" onClick={onApply} disabled={pending || invalid || !editable || editing}>
          {pending ? 'Applying…' : 'Apply'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDiscard} disabled={pending || editing}>
          Discard
        </Button>
        {!pending && (
          <span role="status" className="text-caption text-xs">
            Unapplied
          </span>
        )}
      </div>
    );
    return (
      <div className="flex min-w-0 flex-col gap-1">
        {rows.map((row, index) => {
          const rowKey = row.kind + '-' + row.index;
          const previousEnd = rows[index - 1]?.statement.to ?? session.binding.region.from;
          const matching = sameRegion(row.region);
          const text = matching ? draft!.text : source.slice(row.region.from, row.region.to);
          const prefix = source.slice(row.statement.from, row.region.from).trim();
          const trivia = source.slice(previousEnd, row.statement.from).trim();
          return (
            <div
              key={rowKey}
              data-testid={'expression-row-' + rowKey}
              data-expression-from={row.region.from}
              className="min-w-0 rounded border border-border px-2 py-1"
            >
              {trivia && <pre className="whitespace-pre-wrap font-code text-xs text-caption">{trivia}</pre>}
              <div className="flex min-w-0 flex-wrap items-baseline gap-1">
                {showStatement && <span className="whitespace-pre-wrap font-code text-xs text-primary">{prefix}</span>}
                {editingRow === rowKey || (editable && (!draft || matching) && !editing) ? (
                  <InlineExpressionField
                    session={session}
                    editable={editable}
                    target={expressionRowTarget(row)}
                    compositionArgumentNames={matching ? draft?.argumentNames : undefined}
                    value={text}
                    onChange={(next) => onChange(row, next)}
                    onActiveSlot={onActiveSlot}
                    onEditingChange={(active) => updateEditingRow(active ? rowKey : undefined)}
                    onHighlightRange={onHighlightRange}
                    highlightedRange={highlightedRange}
                  />
                ) : (
                  <span className="whitespace-pre-wrap break-words font-code text-xs">{text}</span>
                )}
              </div>
              {matching && controls}
            </div>
          );
        })}
        {draft?.alias && (
          <div
            className="flex min-w-0 flex-wrap items-baseline gap-1 rounded border border-border px-2 py-1"
            data-testid="expression-row-new"
            data-expression-from={draft.region.from}
          >
            <label className="flex items-center gap-1 font-code text-xs">
              alias
              <input
                className="w-24 border-b border-border bg-background px-1 py-0.5"
                aria-label="Alias name"
                value={draft.alias.name}
                onChange={(event) => draft.alias?.onRename(event.currentTarget.value)}
              />
              :
            </label>
            <InlineExpressionField
              session={session}
              editable={editable}
              target={{ draftAlias: true }}
              compositionArgumentNames={draft.argumentNames}
              value={draft.text}
              onChange={(text) => onChange(undefined, text)}
              onActiveSlot={onActiveSlot}
              onEditingChange={(active) => updateEditingRow(active ? 'new' : undefined)}
            />
            {controls}
          </div>
        )}
        {onAdd && !draft && editable && (
          <Button variant="ghost" size="sm" className="self-start" onClick={onAdd} disabled={editing}>
            + Expression
          </Button>
        )}
        {after}
      </div>
    );
  },
  { op: 'InlineExpressionRows', capture: 0 }
);
