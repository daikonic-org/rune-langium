// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Daikonic contributors

import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  parseExpressionDraft,
  type ExpressionPickerTarget,
  type ExpressionReferenceDetails,
  type ExpressionRow,
  type SourceRegion
} from '@rune-langium/core';
import {
  ExpressionBuilder,
  ExpressionSection,
  useLatestRef,
  type ExpressionBuilderProps,
  type ExpressionSlot,
  type FunctionScope
} from '@rune-langium/visual-editor';
import { Button } from '@rune-langium/design-system/ui/button';
import { SourceEditor } from '../SourceEditor.js';
import { runeDocumentSyntax, runeExpressionSyntax } from '../../lang/rune-syntax.js';
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
  statementTrigger?: ExpressionBuilderProps['statementTrigger'];
  session: InlineExpressionSession;
  target: ExpressionPickerTarget;
  editable?: boolean;
  value: string;
  onChange(value: string): void;
  onActiveSlot?(slot: ExpressionSlot | undefined): void;
  onInspectReference?(reference: ExpressionReferenceDetails): void;
  onEditingChange?(editing: boolean): void;
  onHighlightRange?(range: SourceRegion | undefined): void;
  highlightedRange?: SourceRegion;
};

export const InlineExpressionField = withInstrumentation(
  function InlineExpressionField({
    compositionArgumentNames,
    statementTrigger,
    session,
    target,
    editable = true,
    value,
    onChange,
    onActiveSlot,
    onInspectReference,
    onEditingChange,
    onHighlightRange,
    highlightedRange
  }: InlineExpressionFieldProps) {
    const { binding, documents, file, files, scope } = session;
    const from = 'root' in target ? target.root.from : undefined;
    const to = 'root' in target ? target.root.to : undefined;
    const renderSyntax = useMemo(
      () => runeExpressionSyntax(value, binding, from === undefined || to === undefined ? undefined : { from, to }),
      [value, binding, from, to]
    );
    const current = useLatestRef({ value, files, binding, editable, target });
    const isCurrent = useCallback(() => {
      const latest = documents.capture(binding.uri, binding.nodeId, binding.region);
      return (
        (current.current.editable || binding.readOnly) &&
        latest?.workspaceGeneration === binding.workspaceGeneration &&
        latest.revision === binding.revision &&
        latest.readOnly === binding.readOnly &&
        current.current.binding.uri === binding.uri &&
        current.current.binding.nodeId === binding.nodeId &&
        current.current.files === files &&
        current.current.value === value
      );
    }, [binding, current, documents, files, value]);
    const loadPicker = useCallback(
      async (address: ExpressionPickerTarget, trail: readonly string[]) => {
        if (!isCurrent()) throw new Error('The source changed. Reopen this expression.');
        const { target } = current.current;
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
      [binding, current, file.path, files, isCurrent, value]
    );
    return (
      <ExpressionBuilder
        value={value}
        presentation="inline"
        compositionArgumentNames={compositionArgumentNames}
        statementTrigger={statementTrigger}
        onChange={onChange}
        onBlur={() => {}}
        onActiveSlot={onActiveSlot}
        onInspectReference={onInspectReference}
        onEditingChange={onEditingChange}
        onHighlightRange={onHighlightRange}
        highlightedRange={highlightedRange}
        sourceTarget={target}
        renderSyntax={renderSyntax}
        loadPicker={loadPicker}
        readOnly={binding.readOnly}
        canCommit={() => !binding.readOnly && isCurrent()}
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
  removing?: boolean;
  argumentNames?: readonly string[];
  alias?: { name: string; onRename(name: string): void };
};

export const InlineExpressionRows = withInstrumentation(
  function InlineExpressionRows({
    session,
    rows,
    draft,
    onChange,
    onRemove,
    onAdd,
    onApply,
    onDiscard,
    onActiveSlot,
    onInspectReference,
    onEditingChange,
    onHighlightRange,
    highlightedRange,
    pending,
    editable,
    invalid,
    showStatement = true,
    inspectedRegion,
    onInspect,
    after
  }: {
    session: InlineExpressionSession;
    rows: readonly ExpressionRow[];
    draft?: ExpressionRowDraft;
    onChange(row: ExpressionRow | undefined, text: string): void;
    onRemove?(row: ExpressionRow): void;
    onAdd?(): void;
    onApply(): void;
    onDiscard(): void;
    onActiveSlot?(slot: ExpressionSlot | undefined): void;
    onInspectReference?(reference: ExpressionReferenceDetails): void;
    onEditingChange?(editing: boolean): void;
    onHighlightRange?(range: SourceRegion | undefined): void;
    highlightedRange?: SourceRegion;
    pending: boolean;
    editable: boolean;
    invalid?: boolean;
    showStatement?: boolean;
    inspectedRegion?: SourceRegion;
    onInspect?(row: ExpressionRow): void;
    after?: ReactNode;
  }) {
    const [editingRow, setEditingRow] = useState<string>();
    const list = useRef<HTMLDivElement>(null);
    const discard = useRef<HTMLButtonElement>(null);
    const discardedRemoval = useRef<number>(undefined);
    const removalFrom = draft?.removing ? draft.region.from : undefined;
    useLayoutEffect(() => {
      if (removalFrom !== undefined) {
        discard.current?.focus();
      } else if (discardedRemoval.current !== undefined) {
        list.current
          ?.querySelector<HTMLButtonElement>(
            '[data-expression-from="' + discardedRemoval.current + '"] > [data-expression-remove]'
          )
          ?.focus();
        discardedRemoval.current = undefined;
      }
    }, [removalFrom]);
    const editing = editingRow !== undefined;
    const updateEditingRow = (row: string | undefined) => {
      setEditingRow(row);
      onEditingChange?.(row !== undefined);
    };
    const source = session.binding.source;
    const renderSyntax = runeDocumentSyntax(session.binding);
    const renderTrimmed = (from: number, to: number) => {
      const text = source.slice(from, to).trim();
      if (!text) return null;
      const start = source.indexOf(text, from);
      return renderSyntax({ from: start, to: start + text.length });
    };
    const sameRegion = (region: SourceRegion) => draft?.region.from === region.from && draft?.region.to === region.to;
    const controls = (
      <div className="flex flex-wrap items-center gap-1">
        <Button size="sm" onClick={onApply} disabled={pending || invalid || !editable || editing}>
          {pending ? 'Applying…' : 'Apply'}
        </Button>
        <Button
          ref={discard}
          size="sm"
          variant="ghost"
          onClick={() => {
            discardedRemoval.current = removalFrom;
            onDiscard();
          }}
          disabled={pending || editing}
        >
          Discard
        </Button>
        {!pending && (
          <span role="status" className={draft?.removing ? 'text-xs text-destructive' : 'text-caption text-xs'}>
            {draft?.removing ? 'Statement will be removed' : 'Unapplied'}
          </span>
        )}
      </div>
    );
    return (
      <div ref={list} className="flex min-w-0 flex-col gap-1">
        {rows.map((row, index) => {
          const rowKey = row.kind + '-' + row.index;
          const previousEnd = rows[index - 1]?.statement.to ?? session.binding.region.from;
          const matching = sameRegion(row.region);
          const removing = matching && draft?.removing;
          const inspected = inspectedRegion?.from === row.region.from && inspectedRegion.to === row.region.to;
          const text = matching ? draft!.text : source.slice(row.region.from, row.region.to);
          const prefix = showStatement && renderTrimmed(row.statement.from, row.region.from);
          const trivia = renderTrimmed(previousEnd, row.statement.from);
          const inspectReadOnly = session.binding.readOnly && onInspectReference;
          const inline =
            editingRow === rowKey || ((editable || inspectReadOnly) && (!draft || matching) && !editing && !removing);
          const remove =
            onRemove && prefix && editable && !pending && !editing && (!draft || matching) && !removing
              ? () => onRemove(row)
              : undefined;
          const statementTrigger =
            prefix && onInspect && inline && !inspectReadOnly
              ? { label: prefix.text, content: prefix.content, selected: inspected }
              : undefined;
          return (
            <ExpressionSection
              key={rowKey}
              data-testid={'expression-row-' + rowKey}
              data-expression-from={row.region.from}
              data-expression-selected={inspected || undefined}
              data-expression-removing={removing || undefined}
              label={onRemove && prefix ? prefix.text.replace(/:$/, '') : undefined}
              onRemove={remove}
              className="min-w-0 rounded border border-border px-2 py-1 data-[expression-selected]:border-primary data-[expression-removing]:border-destructive"
              onFocusCapture={() => onInspect?.(row)}
            >
              {trivia && <pre className="whitespace-pre-wrap font-code text-xs text-caption">{trivia.content}</pre>}
              <div className="flex min-w-0 flex-wrap items-baseline gap-1">
                {prefix &&
                  !statementTrigger &&
                  (onInspect ? (
                    <Button
                      size="xs"
                      variant="outline"
                      aria-label={prefix.text}
                      aria-pressed={inspected}
                      data-expression-section-handle
                      className="h-auto min-h-6 min-w-0 max-w-full whitespace-normal break-all font-code text-xs"
                      onClick={() => onInspect(row)}
                    >
                      <span className="min-w-0 wrap-anywhere">{prefix.content}</span>
                    </Button>
                  ) : (
                    <span className="whitespace-pre-wrap font-code text-xs">{prefix.content}</span>
                  ))}
                {inline ? (
                  <InlineExpressionField
                    session={session}
                    editable={editable}
                    target={expressionRowTarget(row)}
                    compositionArgumentNames={matching ? draft?.argumentNames : undefined}
                    statementTrigger={statementTrigger}
                    value={text}
                    onChange={(next) => onChange(row, next)}
                    onActiveSlot={(slot) => {
                      if (slot) onInspect?.(row);
                      onActiveSlot?.(slot);
                    }}
                    onInspectReference={onInspectReference}
                    onEditingChange={(active) => updateEditingRow(active ? rowKey : undefined)}
                    onHighlightRange={onHighlightRange}
                    highlightedRange={highlightedRange}
                  />
                ) : (
                  <span className="whitespace-pre-wrap break-words font-code text-xs">
                    {matching
                      ? runeExpressionSyntax(text, session.binding, row.region)({ from: 0, to: text.length })
                      : renderSyntax(row.region).content}
                  </span>
                )}
              </div>
              {matching && controls}
            </ExpressionSection>
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
              onInspectReference={onInspectReference}
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
