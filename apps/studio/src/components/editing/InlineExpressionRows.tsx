// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Daikonic contributors

import { useCallback, useRef, type ReactNode } from 'react';
import {
  parseExpression,
  type ExpressionPickerTarget,
  type ExpressionRow,
  type SourceRegion
} from '@rune-langium/core';
import { ExpressionBuilder, type ExpressionSlot, type FunctionScope } from '@rune-langium/visual-editor';
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
  session: InlineExpressionSession;
  target: ExpressionPickerTarget;
  value: string;
  onChange(value: string): void;
  onActiveSlot?(slot: ExpressionSlot | undefined): void;
  onHighlightRange?(range: SourceRegion | undefined): void;
  highlightedRange?: SourceRegion;
};

export const InlineExpressionField = withInstrumentation(
  function InlineExpressionField({
    session,
    target,
    value,
    onChange,
    onActiveSlot,
    onHighlightRange,
    highlightedRange
  }: InlineExpressionFieldProps) {
    const { binding, documents, file, files, scope } = session;
    const current = useRef({ value, files });
    current.current = { value, files };
    const loadPicker = useCallback(
      async (address: ExpressionPickerTarget, trail: readonly string[]) => {
        const fresh = () => {
          const latest = documents.capture(binding.uri, binding.nodeId, binding.region);
          return (
            latest?.workspaceGeneration === binding.workspaceGeneration &&
            latest.revision === binding.revision &&
            current.current.files === files &&
            current.current.value === value
          );
        };
        if (!fresh()) throw new Error('The source changed. Reopen this expression.');
        let candidateSource: string | undefined;
        if ('root' in address && 'root' in target) {
          const { from, to } = target.root;
          if (binding.source.slice(from, to) !== value) {
            // Empty is a valid, same-width stand-in for a draft argument hole.
            // It exists only in the worker's private candidate.
            const candidate = parseExpression(value).hasErrors ? value.replaceAll('(<?>)', 'empty') : value;
            if (parseExpression(candidate).hasErrors) {
              address = target;
            } else candidateSource = binding.source.slice(0, from) + candidate + binding.source.slice(to);
          }
        }
        const result = await requestExpressionPickerContext(
          file.path,
          binding.nodeId,
          { target: address, trail, candidateSource },
          files
        );
        if (!fresh()) throw new Error('The source changed. Reopen this expression.');
        return result;
      },
      [binding, documents, file.path, files, target, value]
    );
    return (
      <ExpressionBuilder
        value={value}
        presentation="inline"
        onChange={onChange}
        onBlur={() => {}}
        onActiveSlot={onActiveSlot}
        onHighlightRange={onHighlightRange}
        highlightedRange={highlightedRange}
        sourceTarget={target}
        loadPicker={loadPicker}
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
    onHighlightRange?(range: SourceRegion | undefined): void;
    highlightedRange?: SourceRegion;
    pending: boolean;
    editable: boolean;
    invalid?: boolean;
    showStatement?: boolean;
    after?: ReactNode;
  }) {
    const source = session.binding.source;
    const sameRegion = (region: SourceRegion) => draft?.region.from === region.from && draft?.region.to === region.to;
    const controls = (
      <div className="flex items-center gap-1">
        <Button size="sm" onClick={onApply} disabled={pending || invalid || !editable}>
          {pending ? 'Applying…' : 'Apply'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDiscard} disabled={pending}>
          Discard
        </Button>
      </div>
    );
    return (
      <div className="flex min-w-0 flex-col gap-1">
        {rows.map((row, index) => {
          const previousEnd = rows[index - 1]?.statement.to ?? session.binding.region.from;
          const matching = sameRegion(row.region);
          const text = matching ? draft!.text : source.slice(row.region.from, row.region.to);
          const prefix = source.slice(row.statement.from, row.region.from).trim();
          const trivia = source.slice(previousEnd, row.statement.from).trim();
          return (
            <div
              key={row.kind + '-' + row.index}
              data-testid={'expression-row-' + row.kind + '-' + row.index}
              data-expression-from={row.region.from}
              className="min-w-0 rounded border border-border px-2 py-1"
            >
              {trivia && <pre className="whitespace-pre-wrap font-code text-xs text-caption">{trivia}</pre>}
              <div className="flex min-w-0 flex-wrap items-baseline gap-1">
                {showStatement && <span className="whitespace-pre-wrap font-code text-xs text-primary">{prefix}</span>}
                {editable && (!draft || matching) ? (
                  <InlineExpressionField
                    session={session}
                    target={expressionRowTarget(row)}
                    value={text}
                    onChange={(next) => onChange(row, next)}
                    onActiveSlot={onActiveSlot}
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
              target={{ draftAlias: true }}
              value={draft.text}
              onChange={(text) => onChange(undefined, text)}
              onActiveSlot={onActiveSlot}
            />
            {controls}
          </div>
        )}
        {onAdd && !draft && editable && (
          <Button variant="ghost" size="sm" className="self-start" onClick={onAdd}>
            + Expression
          </Button>
        )}
        {after}
      </div>
    );
  },
  { op: 'InlineExpressionRows', capture: 0 }
);
