// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  EXPRESSION_DRAFT_HOLE as hole,
  getCompositionCallExpression,
  getExpressionOperatorRegion,
  getNodeSourceRegion,
  parseExpression,
  parseExpressionDraft,
  type ExpressionPickerContext,
  type ExpressionPickerTarget,
  type RosettaExpression,
  type SourceRegion
} from '@rune-langium/core';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  type CommandEntry
} from '@rune-langium/design-system/ui/command';
import { PickerTrigger } from '@rune-langium/design-system/ui/picker';
import { Popover, PopoverContent, PopoverTrigger } from '@rune-langium/design-system/ui/popover';
import { Button } from '@rune-langium/design-system/ui/button';
import { Input } from '@rune-langium/design-system/ui/input';
import type { ExpressionBuilderProps } from './ExpressionBuilder.js';
import { astToExpressionNode, expressionNodeSource } from '../../../adapters/ast-to-expression-node.js';
import { expressionNodeToDslPreview } from '../../../adapters/expression-node-to-dsl.js';
import { useLatestRef } from '../../../hooks/useLatestRef.js';
import type { ExpressionNode } from '../../../schemas/expression-node-schema.js';
import { getChildren, replaceInTree, type FunctionScope } from '../../../store/expression-store.js';
import { OPERATOR_CATALOG, type OperatorDefinition } from './operator-catalog.js';
import { referenceNode, scopedReferences } from './ReferencePicker.js';

export interface ExpressionSlot {
  nodeId: string;
  target: ExpressionPickerTarget;
  /** Use the same guarded replacement as the slot picker. */
  replace(text: string): void;
  /** Search the same linked scope when a variable is selected from the tray. */
  openPicker(query: string): void;
}

export interface InlineExpressionOptions {
  compositionArgumentNames?: readonly string[];
  sourceTarget?: ExpressionPickerTarget;
  loadPicker?(target: ExpressionPickerTarget, trail: readonly string[]): Promise<ExpressionPickerContext>;
  canCommit?(): boolean;
  onActiveSlot?(slot: ExpressionSlot | undefined): void;
  onEditingChange?(editing: boolean): void;
  onHighlightRange?(range: SourceRegion | undefined): void;
  highlightedRange?: SourceRegion;
}

function inlineTree(source: string): ExpressionNode {
  const { parsed } = parseExpressionDraft(source);
  return parsed.hasErrors
    ? { $type: source ? 'Unsupported' : 'Placeholder', id: 'inline-root', rawText: source }
    : astToExpressionNode(parsed.value, source);
}

function relativePath(node: RosettaExpression | undefined): string {
  type Location = { $container?: Location; $containerProperty?: string; $containerIndex?: number };
  const parts: string[] = [];
  for (
    let current: Location | undefined = node;
    current?.$container && current.$containerProperty;
    current = current.$container
  ) {
    parts.unshift(
      current.$containerProperty + (current.$containerIndex === undefined ? '' : '@' + current.$containerIndex)
    );
  }
  return parts.length ? '/' + parts.join('/') : '';
}

function firstHole(node: ExpressionNode): ExpressionNode | undefined {
  if (node.$type === 'Placeholder') return node;
  for (const child of getChildren(node)) {
    const found = firstHole(child);
    if (found) return found;
  }
  return undefined;
}

function operatorText(operator: OperatorDefinition, wrapped?: string): string {
  let node = operator.createNode(() => crypto.randomUUID());
  const target = wrapped && firstHole(node);
  if (target) {
    node = replaceInTree(node, String(target.id), { $type: 'Unsupported', id: target.id, rawText: wrapped });
  }
  return expressionNodeToDslPreview(node);
}

function literalText(query: string): string | undefined {
  const text = query.trim();
  if (/^(true|false)$/i.test(text)) return text.toLowerCase() === 'true' ? 'True' : 'False';
  if (/^-?\d+(?:\.\d+)?$/.test(text) || /^(['"])(?:\\.|[^\\])*\1$/.test(text)) {
    if (!parseExpression(text).hasErrors) return text;
  }
  return undefined;
}

type SlotControl = {
  id: string;
  argumentIndex?: number;
  label: string;
  display: string;
  text?: string;
  target: ExpressionPickerTarget;
  range: SourceRegion;
  replace(text: string): boolean;
  placeholder?: boolean;
  operators?: readonly OperatorDefinition[];
};
type SlotEdit = { slot: SlotControl; text: string; raw: boolean; error?: string };

type PickerAction = { kind: 'value'; text: string } | { kind: 'browse'; id: string; label: string } | { kind: 'raw' };

function InlinePicker({
  slot,
  scope,
  loadPicker,
  initialQuery,
  choose
}: {
  slot: SlotControl;
  scope: FunctionScope;
  loadPicker: InlineExpressionOptions['loadPicker'];
  initialQuery?: string;
  choose(action: PickerAction): void;
}) {
  const [trail, setTrail] = useState<{ id: string; label: string }[]>([]);
  const [query, setQuery] = useState(initialQuery ?? '');
  const [context, setContext] = useState<ExpressionPickerContext>();
  const [status, setStatus] = useState('');
  useEffect(() => {
    if (!loadPicker || slot.operators) return;
    let current = true;
    setContext(undefined);
    setStatus('Loading scope…');
    loadPicker(
      slot.target,
      trail.map(({ id }) => id)
    ).then(
      (result) => {
        if (current) {
          setContext(result);
          setStatus('');
        }
      },
      (error: unknown) => {
        if (current) setStatus(error instanceof Error ? error.message : 'Scope unavailable');
      }
    );
    return () => {
      current = false;
    };
  }, [loadPicker, slot.target, slot.operators, trail]);

  const group = (id: string, items: CommandEntry<PickerAction>[]) => ({ id, items });
  const value = (label: string, text: string, searchText?: string): CommandEntry<PickerAction> => ({
    label,
    searchText,
    value: { kind: 'value', text }
  });
  const browse = (label: string, id: string): CommandEntry<PickerAction> => ({
    label: label + ' · Browse',
    value: { kind: 'browse', id, label }
  });
  const entries = context
    ? context.entries.map((entry) => ({ ...entry, origin: entry.kind }))
    : loadPicker
      ? []
      : scopedReferences(scope);
  const choices = entries.flatMap((entry) => {
    const label = [entry.name, entry.typeName, entry.cardinality].filter(Boolean).join(' ');
    const browseId = 'canBrowse' in entry && entry.canBrowse === true ? entry.declarationId : undefined;
    const compatible = !('compatibility' in entry) || entry.compatibility !== 'incompatible';
    const direct = compatible
      ? [
          value(
            browseId ? 'Use ' + entry.name : label,
            entry.referenceText ?? expressionNodeToDslPreview(referenceNode(entry))
          )
        ]
      : [];
    return browseId ? [browse(label, browseId), ...direct] : direct;
  });
  const members = (context?.members ?? []).flatMap((member) => {
    const label = [member.name, member.typeName, member.cardinality].filter(Boolean).join(' ');
    const direct = value(member.canBrowse ? 'Use ' + member.name : label, member.expressionText);
    return member.canBrowse
      ? [browse(label, member.declarationId), ...(member.compatibility === 'incompatible' ? [] : [direct])]
      : member.compatibility === 'incompatible'
        ? []
        : [direct];
  });
  const typed = literalText(query);
  const groups = slot.operators
    ? [
        group(
          'Operators',
          slot.operators.map((operator) => value(operator.label, operator.operator!))
        )
      ]
    : trail.length
      ? [group('Members', members)]
      : [
          ...(typed ? [group('Value', [value('Use ' + typed, typed, query)])] : []),
          group('In scope', choices),
          ...OPERATOR_CATALOG.map((category) =>
            group(
              category.label,
              category.operators.flatMap((operator) => {
                const items = [
                  value(operator.label, operatorText(operator), operator.label + ' ' + operator.description)
                ];
                if (!slot.placeholder && firstHole(operator.createNode(() => 'new'))) {
                  items.push(
                    value('Wrap in ' + operator.label, operatorText(operator, '(' + (slot.text ?? slot.display) + ')'))
                  );
                }
                return items;
              })
            )
          ),
          group('Edit', [
            ...(!slot.placeholder ? [value('Wrap in parentheses', '(' + (slot.text ?? slot.display) + ')')] : []),
            { label: 'Edit Rune', value: { kind: 'raw' } }
          ])
        ];
  return (
    <>
      {context?.expected && (
        <div className="px-2 pt-1 text-xs text-caption">
          {[context.expected.name, context.expected.typeName, context.expected.cardinality].filter(Boolean).join(' · ')}
        </div>
      )}
      {trail.length > 0 && (
        <div className="flex items-center gap-2 border-b border-border px-2 py-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setTrail(trail.slice(0, -1));
              setQuery('');
            }}
          >
            Back
          </Button>
          <span className="min-w-0 truncate font-code text-xs">
            {trail.map((part) => part.label.split(' ')[0]).join(' -> ')}
          </span>
        </div>
      )}
      <Command
        key={trail.map((part) => part.id).join('/')}
        items={groups}
        onItemSelect={(action) => {
          if (action.kind === 'browse') {
            setTrail([...trail, action]);
            setQuery('');
          } else choose(action);
        }}
      >
        <CommandInput
          aria-label={
            slot.operators ? 'Search operators' : trail.length ? 'Search members' : 'Search values and primitives'
          }
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        <CommandList>
          {status && (
            <p role="status" className="px-2 py-1 text-xs text-caption">
              {status}
            </p>
          )}
          {!status && <CommandEmpty>No matching choices</CommandEmpty>}
          {groups.map(({ id }) => (
            <CommandGroup<PickerAction> key={id} id={id} heading={id}>
              {(item, index) => (
                <CommandItem key={index} value={item}>
                  {item.label}
                </CommandItem>
              )}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </>
  );
}

const comparisons = OPERATOR_CATALOG.find(({ id }) => id === 'comparison')!;
const operatorGroups = OPERATOR_CATALOG.filter(({ id }) =>
  ['logic', 'arithmetic', 'collection', 'navigation', 'control'].includes(id)
);

function alternatives(node: ExpressionNode): OperatorDefinition[] {
  const type = String(node.$type);
  if (['ComparisonOperation', 'EqualityOperation'].includes(type)) {
    return comparisons.operators.filter((op) => ['ComparisonOperation', 'EqualityOperation'].includes(op.$type));
  }
  if (['RosettaExistsExpression', 'RosettaAbsentExpression'].includes(type)) {
    if (node.$type === 'RosettaExistsExpression' && node.modifier) return [];
    return operatorGroups.flatMap(({ operators }) =>
      operators.filter((op) => ['RosettaExistsExpression', 'RosettaAbsentExpression'].includes(op.$type))
    );
  }
  const group = operatorGroups.find(({ operators }) => operators.some((op) => op.$type === node.$type));
  if (!group) return [];
  const lambda = ['FilterOperation', 'MapOperation', 'ReduceOperation', 'SortOperation', 'ThenOperation'];
  const unary = [
    'RosettaCountOperation',
    'SumOperation',
    'FlattenOperation',
    'DistinctOperation',
    'FirstOperation',
    'LastOperation',
    'RosettaOnlyElement',
    'ReverseOperation'
  ];
  const eligible = lambda.includes(type) ? lambda : unary.includes(type) ? unary : [type];
  return group.operators.filter((op) => op.operator && eligible.includes(op.$type));
}

function regionOf(node: ExpressionNode, fallback: SourceRegion): SourceRegion {
  const ast = expressionNodeSource(node);
  return ast ? getNodeSourceRegion(ast) : fallback;
}

function needsOperandGrouping(expression: RosettaExpression | undefined, source: string): boolean {
  if (!expression || !('left' in expression || expression.$type === 'RosettaConditionalExpression')) return false;
  const left = 'left' in expression ? expression.left : undefined;
  const start = left?.$cstNode?.offset ?? getExpressionOperatorRegion(expression)?.from;
  const from = expression.$cstNode?.offset;
  // A leading parenthesis around the first operand is not a group around this expression.
  return start === undefined || from === undefined || !source.slice(from, start).trimStart().startsWith('(');
}

export function InlineExpressionBuilder({
  value = '',
  compositionArgumentNames,
  onChange,
  onBlur,
  scope,
  error,
  sourceTarget = { draftAlias: true },
  onActiveSlot,
  onEditingChange,
  loadPicker,
  canCommit,
  onHighlightRange,
  highlightedRange,
  renderTextEditor
}: ExpressionBuilderProps) {
  const source = value ?? '';
  const tree = useMemo(() => inlineTree(source), [source]);
  const rootAst = expressionNodeSource(tree);
  const compositionCall = rootAst && getCompositionCallExpression(rootAst);
  const root = useRef<HTMLDivElement>(null);
  const liveSource = useLatestRef(source);
  const [active, setActive] = useState<{ id: string; query?: string }>();
  const [editing, setEditing] = useState<SlotEdit>();
  const editField = useRef<HTMLSpanElement>(null);
  let editingRendered = false;
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const whole = { from: 0, to: source.length };
  const rootRegion = regionOf(tree, whole);
  const tokens = () => [...(root.current?.querySelectorAll<HTMLButtonElement>('button[data-expression-token]') ?? [])];
  const focusSlot = (id: string) =>
    requestAnimationFrame(() =>
      tokens()
        .find((token) => token.dataset['expressionToken'] === id)
        ?.focus()
    );
  const close = (releaseSlot = false) => {
    setActive(undefined);
    if (releaseSlot) onActiveSlot?.(undefined);
  };
  const update = (range: SourceRegion, text: string) => {
    // An open popover or toolbar action may belong to a prior draft.
    if (liveSource.current !== source || canCommit?.() === false || range.from < 0 || range.to > source.length) {
      return false;
    }
    onChange?.(source.slice(0, range.from) + text + source.slice(range.to));
    return true;
  };
  const targetAt = (node: ExpressionNode, range: SourceRegion, argumentIndex?: number): ExpressionPickerTarget => {
    const from = 'root' in sourceTarget ? sourceTarget.root.from : 0;
    const address = {
      root: { from: from + rootRegion.from, to: from + rootRegion.to },
      path: relativePath(expressionNodeSource(node)),
      range: { from: from + range.from, to: from + range.to },
      argumentIndex
    };
    if ('root' in sourceTarget) return address;
    return rootAst ? { ...sourceTarget, draftAddress: address } : sourceTarget;
  };
  const highlight = (range: SourceRegion | undefined) => {
    const offset = 'root' in sourceTarget ? sourceTarget.root.from : undefined;
    onHighlightRange?.(
      range && offset !== undefined ? { from: offset + range.from, to: offset + range.to } : undefined
    );
  };
  const commit = (slot: SlotControl, text: string, edit?: SlotEdit) => {
    if (!slot.replace(text)) {
      if (edit) setEditing({ ...edit, error: 'The source changed. Discard this edit to continue.' });
      return;
    }
    close(true);
    setEditing(undefined);
    onEditingChange?.(false);
    focusSlot(slot.id);
  };
  const beginEdit = (edit: SlotEdit) => {
    close(true);
    setEditing(edit);
    onEditingChange?.(true);
  };
  const renderEdit = (editing: SlotEdit) => {
    const { slot } = editing;
    const change = (text: string) => setEditing({ ...editing, text, error: undefined });
    const finish = () => {
      const { parsed } = parseExpressionDraft(editing.text);
      if (parsed.hasErrors || !editing.text.trim()) {
        setEditing({ ...editing, error: 'Complete the Rune expression before continuing.' });
        editField.current?.querySelector<HTMLElement>('input, textarea, [contenteditable="true"]')?.focus();
        return;
      }
      commit(slot, editing.text, editing);
    };
    const cancel = () => {
      setEditing(undefined);
      onEditingChange?.(false);
      focusSlot(slot.id);
    };
    return (
      <span
        key={slot.id}
        ref={editField}
        data-testid={editing.raw ? 'inline-rune-draft' : undefined}
        className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-1 font-code"
      >
        {editing.raw && renderTextEditor ? (
          renderTextEditor({ value: editing.text, onChange: change, onBlur: () => {} })
        ) : (
          <Input
            aria-label={editing.raw ? 'Rune expression' : slot.label}
            aria-invalid={Boolean(editing.error)}
            autoFocus
            className="w-36 font-code text-xs"
            value={editing.text}
            onChange={(event) => change(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                cancel();
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                finish();
              }
            }}
          />
        )}
        <Button size="sm" variant="secondary" onClick={finish}>
          Done
        </Button>
        <Button size="sm" variant="ghost" onClick={cancel}>
          Cancel
        </Button>
        {editing.error && (
          <span role="alert" className="text-destructive">
            {editing.error}
          </span>
        )}
      </span>
    );
  };
  const renderSlot = (slot: SlotControl) => {
    const from = 'root' in sourceTarget ? sourceTarget.root.from : undefined;
    const highlighted =
      from !== undefined &&
      highlightedRange &&
      highlightedRange.from >= from + slot.range.from &&
      highlightedRange.to <= from + slot.range.to &&
      highlightedRange.from < from + slot.range.to;
    if (editing?.slot.id === slot.id) {
      editingRendered = true;
      return renderEdit(editing);
    }
    return (
      <Popover
        key={slot.id}
        open={active?.id === slot.id}
        onOpenChange={(open) => {
          if (!open) {
            close();
            return;
          }
          if (editing) return;
          setActive({ id: slot.id });
          onActiveSlot?.({
            nodeId: slot.id,
            target: slot.target,
            replace: (text) => commit(slot, text),
            openPicker: (query) => setActive({ id: slot.id, query })
          });
        }}
      >
        <PopoverTrigger
          render={
            <PickerTrigger
              indicator={false}
              aria-label={slot.label}
              className={
                'h-auto min-h-6 overflow-hidden rounded px-1.5 font-code text-xs font-book ' +
                (highlighted ? 'ring-1 ring-primary ' : '') +
                (slot.placeholder
                  ? 'border-dashed text-caption'
                  : slot.operators
                    ? 'border-transparent bg-transparent text-primary'
                    : '')
              }
              data-expression-token={slot.id}
              data-expression-argument={slot.argumentIndex}
              onFocus={() => highlight(slot.range)}
              onBlur={() => highlight(undefined)}
              onMouseEnter={() => highlight(slot.range)}
              onMouseLeave={() => highlight(undefined)}
              onKeyDown={(event) => {
                if (editing || slot.operators || event.ctrlKey || event.metaKey || event.altKey) return;
                if (event.key === '(' && !slot.placeholder) {
                  event.preventDefault();
                  commit(slot, '(' + (slot.text ?? slot.display) + ')');
                } else if (event.key.length === 1 && event.key !== ' ') {
                  event.preventDefault();
                  beginEdit({ slot, text: event.key, raw: false });
                }
              }}
            >
              <span className="truncate">{slot.display}</span>
            </PickerTrigger>
          }
        />
        {active?.id === slot.id && (
          <PopoverContent aria-label={slot.label} className="w-72 max-w-[calc(100vw-2rem)] p-0" align="start">
            <InlinePicker
              key={JSON.stringify([slot.target, active.query])}
              slot={slot}
              scope={scope}
              loadPicker={loadPicker}
              initialQuery={active.query}
              choose={(action) => {
                if (action.kind === 'value') commit(slot, action.text);
                else if (action.kind === 'raw')
                  beginEdit({ slot, text: slot.placeholder ? '' : (slot.text ?? slot.display), raw: true });
              }}
            />
          </PopoverContent>
        )}
      </Popover>
    );
  };
  function renderNode(node: ExpressionNode, depth: number, argument?: string, parent?: ExpressionNode): ReactNode {
    const ast = expressionNodeSource(node);
    const range = regionOf(node, whole);
    const path = relativePath(ast) || 'root';
    const original = source.slice(range.from, range.to);
    const target = targetAt(node, range);
    const placeholder = node.$type === 'Placeholder' || original === hole || original === '<?>';
    const argumentIndex = parent?.$type === 'RosettaSymbolReference' ? ast?.$containerIndex : undefined;
    const compositionArgumentIndex = ast?.$container === compositionCall ? argumentIndex : undefined;
    const replace = (text: string) => {
      const { parsed } = parseExpressionDraft(text);
      const ast = parsed.hasErrors ? undefined : parsed.value;
      const grouped = depth > 0 && argumentIndex === undefined && needsOperandGrouping(ast, text);
      return update(range, grouped ? '(' + text + ')' : text);
    };
    const label = argument ? argument + ' argument' : placeholder ? 'Add expression' : 'Edit ' + original;
    const callSignature =
      node.$type === 'RosettaSymbolReference'
        ? scope.references?.find((entry) => entry.kind === 'callable' && entry.name === node.symbol)
        : undefined;
    const argumentNames =
      ast && ast === compositionCall
        ? (compositionArgumentNames ?? callSignature?.argumentNames)
        : callSignature?.argumentNames;
    const children =
      node.$type === 'RosettaFeatureCall' || node.$type === 'RosettaDeepFeatureCall'
        ? []
        : getChildren(node)
            .filter((child) => expressionNodeSource(child))
            .map((child) => ({ node: child, range: regionOf(child, range) }))
            .filter((child) => child.range.from >= range.from && child.range.to <= range.to)
            .sort((a, b) => a.range.from - b.range.from);
    const missing = Math.max(0, (argumentNames?.length ?? callSignature?.argumentCount ?? 0) - children.length);
    if (!children.length && !missing) {
      return renderSlot({
        id: path,
        argumentIndex: compositionArgumentIndex,
        range,
        target,
        replace,
        placeholder,
        display: placeholder ? (argument ?? 'Add expression') : original,
        label: argument && !placeholder ? label + ' ' + original : label
      });
    }

    const property = ast && getExpressionOperatorRegion(ast);
    const operators = alternatives(node);
    const syntax = (from: number, to: number) => {
      if (from >= to) return null;
      const before = source.slice(from, to);
      if (!property || property.from < from || property.to > to)
        return <span className="whitespace-pre-wrap">{before}</span>;
      const word = source.slice(property.from, property.to);
      const predicate = node.$type === 'RosettaConditionalExpression' && children[0];
      if (!operators.length && !predicate) return <span className="whitespace-pre-wrap">{before}</span>;
      const gap = { from: property.from, to: property.to };
      const operatorSlot: SlotControl = {
        id: path + '/operator',
        label: predicate ? 'Edit condition' : 'Change ' + word,
        display: word,
        text: predicate ? source.slice(predicate.range.from, predicate.range.to) : undefined,
        range: gap,
        target: predicate ? targetAt(predicate.node, predicate.range) : target,
        operators: predicate ? undefined : operators,
        replace: (text) => {
          if (predicate) return update(predicate.range, text);
          // Group the changed binary expression when its operator changes precedence.
          const precedenceChanges =
            (node.$type === 'LogicalOperation' && word !== text) ||
            (node.$type === 'ArithmeticOperation' && '+-'.includes(text) !== '+-'.includes(word));
          if (precedenceChanges) {
            const left = children[0]!;
            const right = children[1]!;
            const part = (child: typeof left) => {
              const body = source.slice(child.range.from, child.range.to);
              return needsOperandGrouping(expressionNodeSource(child.node), source) ? '(' + body + ')' : body;
            };
            const next =
              source.slice(range.from, left.range.from) +
              part(left) +
              source.slice(left.range.to, gap.from) +
              text +
              source.slice(gap.to, right.range.from) +
              part(right) +
              source.slice(right.range.to, range.to);
            return update(range, depth > 0 ? '(' + next + ')' : next);
          }
          return update(gap, text);
        }
      };
      return (
        <>
          {source.slice(from, gap.from)}
          {renderSlot(operatorSlot)}
          {source.slice(gap.to, to)}
        </>
      );
    };
    const grouping = Boolean(
      callSignature ||
      argumentNames ||
      node.$type === 'RosettaConditionalExpression' ||
      (ast && 'function' in ast) ||
      (parent && 'operator' in parent && 'operator' in node && parent.operator !== node.operator)
    );
    if (grouping && collapsed.has(path)) {
      return (
        <Button
          key={path}
          variant="ghost"
          size="sm"
          onClick={() =>
            setCollapsed((previous) => {
              const next = new Set(previous);
              next.delete(path);
              return next;
            })
          }
        >
          Expand {callSignature?.name ?? 'expression'}
        </Button>
      );
    }
    let cursor = range.from;
    const suffix = missing && original.endsWith(')') ? range.to - 1 : range.to;
    return (
      <span
        key={path}
        className={
          grouping
            ? 'inline-flex min-w-0 max-w-full flex-wrap items-baseline gap-0.5 rounded border border-border px-1 py-0.5 ' +
              (depth > 1 ? 'bg-muted/35' : 'bg-muted/15')
            : 'contents'
        }
      >
        {children.map((child, index) => {
          const gap = syntax(cursor, child.range.from);
          cursor = child.range.to;
          return (
            <span key={child.range.from} className="contents">
              {gap}
              {renderNode(child.node, depth + 1, argumentNames?.[index], node)}
            </span>
          );
        })}
        {syntax(cursor, suffix)}
        {missing > 0 && (
          <>
            {!original.endsWith(')') && '('}
            {Array.from({ length: missing }, (_, index) => {
              const position = children.length + index;
              const name = argumentNames?.[position] ?? 'Argument ' + (position + 1);
              return (
                <span className="contents" key={name}>
                  {position > 0 && ', '}
                  {renderSlot({
                    id: path + '/missing/' + index,
                    argumentIndex: ast === compositionCall ? position : undefined,
                    label: name + ' argument',
                    display: name,
                    target: targetAt(node, range, position),
                    range,
                    placeholder: true,
                    replace: (text) => {
                      const additions = Array.from({ length: missing }, (_, offset) =>
                        offset === index ? text : hole
                      ).join(', ');
                      const insert = original.endsWith(')')
                        ? (children.length ? ', ' : '') + additions
                        : '(' + additions + ')';
                      return update({ from: suffix, to: suffix }, insert);
                    }
                  })}
                </span>
              );
            })}
            {')'}
          </>
        )}
        {grouping && (
          <button
            type="button"
            className="inline-flex px-1 text-xs text-muted-foreground"
            aria-label={'Collapse ' + (callSignature?.name ?? 'expression')}
            onClick={() => setCollapsed((previous) => new Set([...previous, path]))}
          >
            −
          </button>
        )}
        {compositionArgumentIndex !== undefined &&
          renderSlot({
            id: path + '/actions',
            argumentIndex: compositionArgumentIndex,
            label: (argument ?? 'Argument ' + (compositionArgumentIndex + 1)) + ' argument actions',
            display: '…',
            text: original,
            target,
            range,
            replace
          })}
      </span>
    );
  }
  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLButtonElement) || !event.target.dataset['expressionToken']) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const ordered = tokens();
    const index = ordered.indexOf(event.target);
    const next = ordered[index + (event.key === 'ArrowLeft' ? -1 : 1)];
    if (next) {
      event.preventDefault();
      next.focus();
    }
  };
  return (
    <div
      ref={root}
      className="flex min-w-0 max-w-full flex-wrap items-baseline gap-1 font-code text-xs font-book"
      data-testid="inline-expression-builder"
      aria-label="Expression"
      onKeyDown={moveFocus}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onBlur?.();
      }}
    >
      {renderNode(tree, 0)}
      {getChildren(tree).length > 0 &&
        renderSlot({
          id: 'root/actions',
          label: 'Expression actions',
          display: '…',
          text: source,
          range: whole,
          target: targetAt(tree, rootRegion),
          replace: (text) => update(whole, text)
        })}
      {editing && !editingRendered && renderEdit(editing)}
      {error && (
        <span role="alert" className="text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}
