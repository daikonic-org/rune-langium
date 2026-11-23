// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import {
  EXPRESSION_DRAFT_HOLE as hole,
  getCompositionCallExpression,
  getConstructorMemberLabelRegion,
  getMemberAccessOperatorRegions,
  getSourceComments,
  getSymbolReferenceRegions,
  isConstructorKeyValuePair,
  isSwitchCaseOrDefault,
  getExpressionOperatorRegion,
  getNodeSourceRegion,
  getSwitchCaseRemoval,
  retainCommentTrivia,
  parseExpression,
  parseExpressionDraft,
  type ExpressionPickerContext,
  type ExpressionPickerTarget,
  type ExpressionReferenceDetails,
  type RosettaExpression,
  type SourceRegion,
  type SwitchCaseGuard
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
import { ExpressionSection } from './ExpressionSection.js';
import { astToExpressionNode, expressionNodeSource } from '../../../adapters/ast-to-expression-node.js';
import { expressionNodeToDslPreview } from '../../../adapters/expression-node-to-dsl.js';
import { useLatestRef } from '../../../hooks/useLatestRef.js';
import type { ExpressionNode } from '../../../schemas/expression-node-schema.js';
import {
  getChildren,
  replaceInTree,
  type FunctionScope,
  type FunctionScopeEntry
} from '../../../store/expression-store.js';
import {
  ALL_OPERATORS,
  EXPRESSION_OPERATOR_MIME,
  OPERATOR_CATALOG,
  SWITCH_GUARD_HOLE,
  type OperatorDefinition
} from './operator-catalog.js';
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
  /** Use the surrounding statement label as the whole-expression picker trigger. */
  statementTrigger?: { label: string; content: ReactNode; selected?: boolean };
  sourceTarget?: ExpressionPickerTarget;
  loadPicker?(target: ExpressionPickerTarget, trail: readonly string[]): Promise<ExpressionPickerContext>;
  readOnly?: boolean;
  onInspectReference?(reference: ExpressionReferenceDetails): void;
  canCommit?(): boolean;
  onActiveSlot?(slot: ExpressionSlot | undefined): void;
  onEditingChange?(editing: boolean): void;
  onHighlightRange?(range: SourceRegion | undefined): void;
  highlightedRange?: SourceRegion;
  /** Render syntax from this expression's original offsets, without changing the edit target. */
  renderSyntax?(range: SourceRegion): ReactNode;
}

function isPlaceholder(node: ExpressionNode, text: string): boolean {
  return node.$type === 'Placeholder' || text === hole || text === '<?>';
}

function inlineTree(source: string): ExpressionNode {
  const { parsed } = parseExpressionDraft(source);
  return parsed.hasErrors
    ? { $type: source ? 'Unsupported' : 'Placeholder', id: 'inline-root', rawText: source }
    : astToExpressionNode(parsed.value, source);
}

function relativePath(node: RosettaExpression | SwitchCaseGuard | undefined): string {
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
  if (wrapped) {
    const operand = { $type: 'Unsupported', id: crypto.randomUUID(), rawText: wrapped } as const;
    if (node.$type === 'RosettaConditionalExpression') {
      node = { ...node, ifthen: operand };
    } else {
      const target = firstHole(node);
      if (target) node = replaceInTree(node, String(target.id), operand);
    }
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

function switchMatchText(query: string): string | undefined {
  const text = literalText(query) ?? query.trim();
  if (!text) return undefined;
  const prefix = '0 switch ';
  const parsed = parseExpression(prefix + text + ' then 0');
  const guard = !parsed.hasErrors && parsed.value.$type === 'SwitchOperation' && parsed.value.cases[0]?.guard;
  if (!guard) return undefined;
  const range = getNodeSourceRegion(guard);
  return range.from === prefix.length && range.to === prefix.length + text.length ? text : undefined;
}

type SlotControl = {
  id: string;
  argumentIndex?: number;
  parameterName?: string;
  reference?: boolean;
  label: string;
  display: string;
  content?: ReactNode;
  text?: string;
  target: ExpressionPickerTarget;
  range: SourceRegion;
  replace(text: string): boolean;
  placeholder?: boolean;
  switchMatch?: true;
  operators?: readonly OperatorDefinition[];
};
type SlotEdit = { slot: SlotControl; text: string; raw: boolean; error?: string };

type PickerAction = { kind: 'value'; text: string } | { kind: 'browse'; id: string; label: string } | { kind: 'raw' };

type PickerEntry = CommandEntry<PickerAction> & { caption?: string };
const compareNames = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });

function callableChoices(entries: readonly FunctionScopeEntry[], query: string): PickerEntry[] {
  const declarations = new Map<string, FunctionScopeEntry>();
  for (const entry of entries) {
    const id = entry.declarationId ?? entry.name;
    if (!declarations.has(id) || !entry.name.includes('.')) declarations.set(id, entry);
  }
  return [...declarations.values()]
    .flatMap<PickerEntry>((entry) => {
      const separator = entry.name.lastIndexOf('.');
      const label = entry.name.slice(separator + 1);
      const namespace = entry.namespace ?? (separator < 0 ? undefined : entry.name.slice(0, separator));
      const searchText = namespace ? label + ' ' + namespace + '.' + label : label;
      if (!searchText.toLowerCase().includes(query)) return [];
      return [
        {
          label,
          searchText,
          caption: [namespace, entry.typeName, entry.cardinality].filter(Boolean).join(' · '),
          value: { kind: 'value', text: entry.referenceText ?? expressionNodeToDslPreview(referenceNode(entry)) }
        }
      ];
    })
    .sort((a, b) => a.label.localeCompare(b.label) || (a.searchText ?? '').localeCompare(b.searchText ?? ''));
}

const pickerCategories = [
  ...OPERATOR_CATALOG.filter(({ id }) => id === 'control'),
  ...OPERATOR_CATALOG.filter(({ id }) => id !== 'control')
];

function InlinePicker({
  slot,
  scope,
  loadPicker,
  initialQuery,
  readOnly,
  onInspectReference,
  onCloseEmpty,
  choose
}: {
  slot: SlotControl;
  scope: FunctionScope;
  loadPicker: InlineExpressionOptions['loadPicker'];
  initialQuery?: string;
  readOnly: boolean;
  onInspectReference?: InlineExpressionOptions['onInspectReference'];
  onCloseEmpty?(): void;
  choose(action: PickerAction): void;
}) {
  const [trail, setTrail] = useState<{ id: string; label: string }[]>([]);
  const [query, setQuery] = useState(initialQuery ?? '');
  const [context, setContext] = useState<ExpressionPickerContext>();
  const [status, setStatus] = useState('');
  const inspect = useLatestRef(onInspectReference);
  const closeEmpty = useLatestRef(onCloseEmpty);
  const target = useLatestRef(slot.target);
  const targetKey = JSON.stringify(slot.target);
  useEffect(() => {
    if (!loadPicker || slot.operators || slot.switchMatch) return;
    let current = true;
    setContext(undefined);
    setStatus('Loading scope…');
    loadPicker(
      target.current,
      trail.map(({ id }) => id)
    ).then(
      (result) => {
        if (current) {
          setContext(result);
          setStatus('');
          if (result.inspected && (slot.reference || trail.length)) inspect.current?.(result.inspected);
          if (readOnly && !trail.length && (result.referencePath?.length ?? 0) < 2 && !result.enumValues?.length)
            closeEmpty.current?.();
        }
      },
      (error: unknown) => {
        if (current) setStatus(error instanceof Error ? error.message : 'Scope unavailable');
      }
    );
    return () => {
      current = false;
    };
  }, [
    loadPicker,
    targetKey,
    target,
    slot.operators,
    slot.switchMatch,
    slot.reference,
    trail,
    inspect,
    readOnly,
    closeEmpty
  ]);

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
  // Missing type information does not establish incompatibility.
  const fits = (entry: { name: string; compatibility?: string }) => entry.compatibility !== 'incompatible';
  const choices = entries
    .filter((entry) => entry.origin !== 'callable' && !(entry.origin === 'enum' && context?.enumValues?.length))
    .sort(compareNames)
    .flatMap((entry) => {
      const label = [entry.name, entry.typeName, entry.cardinality].filter(Boolean).join(' ');
      const browseId = 'canBrowse' in entry && entry.canBrowse === true ? entry.declarationId : undefined;
      const direct = fits(entry)
        ? [
            value(
              browseId ? 'Use ' + entry.name : label,
              entry.referenceText ?? expressionNodeToDslPreview(referenceNode(entry))
            )
          ]
        : [];
      return browseId ? [browse(label, browseId), ...direct] : direct;
    });
  const members = (context?.members ?? []).toSorted(compareNames).flatMap((member) => {
    const label = [member.name, member.typeName, member.cardinality].filter(Boolean).join(' ');
    const direct = value(member.canBrowse ? 'Use ' + member.name : label, member.expressionText);
    return member.canBrowse
      ? [browse(label, member.declarationId), ...(fits(member) ? [direct] : [])]
      : fits(member)
        ? [direct]
        : [];
  });
  const search = query.trim().toLowerCase();
  const callables =
    search && !slot.operators && !trail.length
      ? callableChoices(
          entries.filter((entry) => entry.origin === 'callable' && fits(entry)),
          search
        )
      : [];
  const typed = slot.switchMatch ? switchMatchText(query) : literalText(query);
  const enumValues = (context?.enumValues ?? [])
    .filter(fits)
    .sort(compareNames)
    .map((entry) => value(entry.name, entry.expressionText));
  const enumGroup = group('Enum values', enumValues);
  const groups = slot.switchMatch
    ? [group('Case match', typed ? [value('Use ' + typed, typed, query)] : [])]
    : slot.operators
      ? [
          group(
            'Operators',
            slot.operators.map((operator) => value(operator.label, operator.operator!))
          )
        ]
      : trail.length
        ? [group('Members', members)]
        : readOnly
          ? [enumGroup]
          : [
              enumGroup,
              ...(typed ? [group('Value', [value('Use ' + typed, typed, query)])] : []),
              group('In scope', choices),
              group('Functions', callables),
              ...pickerCategories.map((category) =>
                group(
                  category.label,
                  category.operators.flatMap((operator) => {
                    const searchText = [operator.label, operator.description, category.label].join(' ');
                    const items = [value(operator.label, operatorText(operator), searchText)];
                    if (!slot.placeholder && firstHole(operator.createNode(() => 'new'))) {
                      items.push(
                        value(
                          'Wrap in ' + operator.label,
                          operatorText(operator, slot.text ?? slot.display),
                          'Wrap in ' + searchText
                        )
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
      {(context?.expected || slot.parameterName) && (
        <div className="px-2 pt-1 text-xs text-caption">
          {[context?.expected?.name ?? slot.parameterName, context?.expected?.typeName, context?.expected?.cardinality]
            .filter(Boolean)
            .join(' · ')}
        </div>
      )}
      {slot.reference && !trail.length && context?.referencePath && context.referencePath.length > 1 && (
        <nav
          aria-label="Reference path"
          className="flex flex-wrap items-center gap-0.5 border-b border-border px-2 py-1"
        >
          {context.referencePath.map((segment, index) => (
            <Fragment key={index}>
              {index > 0 && (
                <span aria-hidden="true" className="text-caption">
                  {segment.deep ? '…' : '.'}
                </span>
              )}
              <Button
                size="xs"
                variant="ghost"
                className="px-1 font-code"
                aria-label={'Inspect ' + segment.name}
                title={segment.typeName}
                onClick={() => {
                  onInspectReference?.(segment);
                  if (segment.browseId) {
                    setTrail([{ id: segment.browseId, label: segment.name }]);
                    setQuery('');
                  }
                }}
              >
                {segment.name}
              </Button>
            </Fragment>
          ))}
        </nav>
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
            {trail.map((part) => part.label.split(' ')[0]).join('.')}
          </span>
        </div>
      )}
      {(!readOnly || status || groups.some(({ items }) => items.length)) && (
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
              slot.switchMatch
                ? 'Switch case match'
                : slot.operators
                  ? 'Search operators'
                  : trail.length
                    ? 'Search members'
                    : 'Search values and primitives'
            }
            placeholder={
              slot.switchMatch
                ? 'Enter a literal or case name…'
                : slot.operators
                  ? 'Search operators…'
                  : trail.length
                    ? 'Search members…'
                    : 'Search values, primitives, or functions…'
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
                  <CommandItem key={index} value={item} disabled={readOnly && item.value.kind === 'value'}>
                    {'caption' in item && typeof item.caption === 'string' ? (
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{item.label}</span>
                        <small className="truncate text-2xs text-caption">{item.caption}</small>
                      </span>
                    ) : (
                      item.label
                    )}
                  </CommandItem>
                )}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      )}
    </>
  );
}

const groupSurfaces = ['bg-background', 'bg-card/60', 'bg-card'] as const;
const switchRowInset = 'border ps-1';
const associativeOperators = new Set(['and', 'or', '+', '*']);
const expressionControl = 'h-auto min-h-6 overflow-hidden rounded px-1.5 font-code text-xs font-book';
const branchSlots = new Map([
  ['if', { label: 'Add condition', hint: 'Condition' }],
  ['ifthen', { label: 'Add then value', hint: 'Value' }],
  ['elsethen', { label: 'Add else value', hint: 'Value' }]
]);

function placeholderHint(node: RosettaExpression | undefined) {
  const parent = node?.$container;
  if (!parent || !node?.$containerProperty) return undefined;
  switch (parent.$type) {
    case 'RosettaConditionalExpression':
      return branchSlots.get(node.$containerProperty);
    case 'SwitchCaseOrDefault':
      return { label: parent.guard ? 'Add case value' : 'Add default value', hint: 'Value' };
    case 'DefaultOperation':
      return node.$containerProperty === 'right' ? { label: 'Add fallback value', hint: 'Fallback' } : undefined;
    case 'InlineFunction':
      if (parent.$container?.$type === 'MapOperation') return { label: 'Add item result', hint: 'Item result' };
      if (parent.$container?.$type === 'FilterOperation') return { label: 'Add filter condition', hint: 'Condition' };
      return undefined;
    default:
      return undefined;
  }
}

function expressionBody(node: RosettaExpression): keyof typeof branchLabels | 'case' | 'default' | undefined {
  const parent = node.$container;
  switch (parent?.$type) {
    case 'RosettaConditionalExpression':
      if (parent.ifthen === node) return 'then';
      return parent.elsethen === node ? 'else' : undefined;
    case 'SwitchCaseOrDefault':
      return parent.guard ? 'case' : 'default';
    case 'InlineFunction':
      return 'callback';
    case 'DefaultOperation':
      return parent.right === node ? 'fallback' : undefined;
    default:
      return undefined;
  }
}

function expressionGroupLabel(ast: RosettaExpression | undefined): string {
  switch (ast?.$type) {
    case 'RosettaSymbolReference':
      return ast.symbol.$refText + ' call';
    case 'RosettaSuperCall':
      return 'super call';
    case 'RosettaConstructorExpression':
      return 'constructor';
    case 'ListLiteral':
      return 'list';
    case 'RosettaConditionalExpression':
      return 'if expression';
    default:
      return ast && 'operator' in ast && ast.operator ? ast.operator + ' expression' : 'expression';
  }
}

const branchLabels = {
  then: 'then value',
  else: 'else clause',
  callback: 'callback body',
  fallback: 'fallback value'
} as const;

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
  if (!expression) return false;
  const binary = 'left' in expression;
  const switching = expression.$type === 'SwitchOperation';
  if (!binary && !switching && expression.$type !== 'RosettaConditionalExpression') return false;
  const first = binary ? expression.left : switching ? expression.argument : undefined;
  const start = first?.$cstNode?.offset ?? getExpressionOperatorRegion(expression)?.from;
  const from = expression.$cstNode?.offset;
  // A leading parenthesis around the first operand is not a group around this expression.
  return start === undefined || from === undefined || !source.slice(from, start).trimStart().startsWith('(');
}

export function InlineExpressionBuilder({
  value = '',
  compositionArgumentNames,
  statementTrigger,
  onChange,
  onBlur,
  scope,
  error,
  sourceTarget = { draftAlias: true },
  onActiveSlot,
  onEditingChange,
  loadPicker,
  canCommit,
  readOnly = false,
  onInspectReference,
  onHighlightRange,
  highlightedRange,
  renderSyntax,
  renderTextEditor
}: ExpressionBuilderProps) {
  const source = value ?? '';
  const tree = useMemo(() => inlineTree(source), [source]);
  const comments = useMemo(() => (/\/[*/]/.test(source) ? getSourceComments(source) : []), [source]);
  const rootAst = expressionNodeSource(tree);
  const compositionCall = rootAst && getCompositionCallExpression(rootAst);
  const root = useRef<HTMLDivElement>(null);
  const liveSource = useLatestRef(source);
  const inspection = useRef(0);
  const [active, setActive] = useState<{ id: string; query?: string }>();
  const [operatorDropTarget, setOperatorDropTarget] = useState<string>();
  const [editing, setEditing] = useState<SlotEdit>();
  const editField = useRef<HTMLSpanElement>(null);
  let editingRendered = false;
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [expandedParameters, setExpandedParameters] = useState<ReadonlySet<string>>(() => new Set());
  const whole = { from: 0, to: source.length };
  const rootRegion = regionOf(tree, whole);
  const tokens = () => [...(root.current?.querySelectorAll<HTMLButtonElement>('button[data-expression-token]') ?? [])];
  const focusSlot = (id: string) => {
    const document = root.current?.ownerDocument;
    if (!document) return;
    const previousFocus = document.activeElement;
    requestAnimationFrame(() => {
      const focus = document.activeElement;
      if (focus && focus !== previousFocus && focus !== document.body) return;
      tokens()
        .find((token) => token.dataset['expressionToken'] === id)
        ?.focus();
    });
  };
  const close = (releaseSlot = false) => {
    setActive(undefined);
    if (releaseSlot) onActiveSlot?.(undefined);
  };
  const update = (range: SourceRegion, text: string) => {
    // An open popover or toolbar action may belong to a prior draft.
    if (
      readOnly ||
      liveSource.current !== source ||
      canCommit?.() === false ||
      range.from < 0 ||
      range.to > source.length
    ) {
      return false;
    }
    onChange?.(source.slice(0, range.from) + text + source.slice(range.to));
    return true;
  };
  const remove = (range: SourceRegion, replacement: string, clearedPath: string, focus = clearedPath) => {
    if (!update(range, replacement)) return;
    close(true);
    setCollapsed(
      (previous) =>
        new Set(
          [...previous].filter(
            (path) => clearedPath !== 'root' && path !== clearedPath && !path.startsWith(clearedPath + '/')
          )
        )
    );
    focusSlot(focus);
  };
  const clearValue = (range: SourceRegion, path: string) =>
    remove(range, hole + retainCommentTrivia(source.slice(range.from, range.to)), path);
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
  const inspectAt = (target: ExpressionPickerTarget, trigger: HTMLElement) => {
    if (!onInspectReference || !loadPicker) return;
    const request = ++inspection.current;
    void loadPicker(target, [])
      .then((result) => {
        if (request === inspection.current && result.inspected && trigger.isConnected)
          onInspectReference(result.inspected);
      })
      .catch(() => undefined);
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
      const text = slot.switchMatch ? switchMatchText(editing.text) : editing.text;
      if (!text?.trim() || (!slot.switchMatch && parseExpressionDraft(text).parsed.hasErrors)) {
        setEditing({
          ...editing,
          error: slot.switchMatch
            ? 'Enter a single Rune literal or case name.'
            : 'Complete the Rune expression before continuing.'
        });
        editField.current?.querySelector<HTMLElement>('input, textarea, [contenteditable="true"]')?.focus();
        return;
      }
      commit(slot, text, editing);
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
  const syntaxSlice = ({ from, to }: SourceRegion) => renderSyntax?.({ from, to }) ?? source.slice(from, to);
  const presentMemberPath = (ast: RosettaExpression, range: SourceRegion) => {
    const operators = getMemberAccessOperatorRegions(ast);
    if (!operators.length) return undefined;
    let offset = range.from;
    const parts = operators.map(({ from, to, operator }) => {
      const textRange = { from: offset, to: offset + source.slice(offset, from).trimEnd().length };
      offset = range.to - source.slice(to, range.to).trimStart().length;
      return { textRange, separator: operator === '->' ? '.' : '…' };
    });
    const tail = { from: offset, to: range.to };
    return {
      text:
        parts.map(({ textRange, separator }) => source.slice(textRange.from, textRange.to) + separator).join('') +
        source.slice(tail.from, tail.to),
      content: (
        <>
          {parts.map(({ textRange, separator }) => (
            <Fragment key={textRange.from}>
              {syntaxSlice(textRange)}
              <span className="text-syntax-operator">{separator}</span>
            </Fragment>
          ))}
          {syntaxSlice(tail)}
        </>
      )
    };
  };
  const renderSlot = (slot: SlotControl, kind: 'operand' | 'statement' | 'operator' = 'operand') => {
    const statement = kind === 'statement';
    if (readOnly && !slot.reference)
      return <span className="whitespace-pre-wrap wrap-anywhere">{slot.content ?? syntaxSlice(slot.range)}</span>;
    const acceptsOperator = !readOnly && !editing && kind !== 'operator';
    const from = 'root' in sourceTarget ? sourceTarget.root.from : undefined;
    const highlighted =
      from !== undefined &&
      highlightedRange &&
      highlightedRange.from >= from + slot.range.from &&
      highlightedRange.to <= from + slot.range.to &&
      highlightedRange.from < from + slot.range.to;
    if (editing?.slot.id === slot.id && !statement) {
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
          ++inspection.current;
          setActive({ id: slot.id, query: slot.switchMatch && !slot.placeholder ? slot.display : undefined });
          if (!readOnly)
            onActiveSlot?.(
              slot.switchMatch
                ? undefined
                : {
                    nodeId: slot.id,
                    target: slot.target,
                    replace: (text) => commit(slot, text),
                    openPicker: (query) => setActive({ id: slot.id, query })
                  }
            );
        }}
      >
        <PopoverTrigger
          render={
            <PickerTrigger
              indicator={false}
              aria-label={slot.label}
              aria-pressed={statement ? statementTrigger?.selected : undefined}
              title={statement ? 'Edit whole expression' : slot.label}
              disabled={statement && Boolean(editing)}
              className={
                expressionControl +
                ' ' +
                (highlighted || operatorDropTarget === slot.id ? 'ring-1 ring-primary ' : '') +
                (slot.placeholder
                  ? 'border-dashed text-caption'
                  : slot.operators && !renderSyntax
                    ? 'text-primary'
                    : '')
              }
              data-expression-token={slot.id}
              data-expression-argument={slot.argumentIndex}
              data-expression-section-handle={statement || slot.switchMatch ? '' : undefined}
              onFocus={() => highlight(slot.range)}
              onBlur={() => highlight(undefined)}
              onMouseEnter={() => highlight(slot.range)}
              onMouseLeave={() => highlight(undefined)}
              onDragOver={(event) => {
                if (!acceptsOperator || !event.dataTransfer.types.includes(EXPRESSION_OPERATOR_MIME)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
                setOperatorDropTarget(slot.id);
              }}
              onDragLeave={(event) => {
                if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
                setOperatorDropTarget((target) => (target === slot.id ? undefined : target));
              }}
              onDrop={(event) => {
                setOperatorDropTarget(undefined);
                if (!acceptsOperator) return;
                const type = event.dataTransfer.getData(EXPRESSION_OPERATOR_MIME);
                const operator = ALL_OPERATORS.find(({ $type }) => $type === type);
                if (!operator) return;
                event.preventDefault();
                event.stopPropagation();
                commit(slot, operatorText(operator, slot.placeholder ? undefined : (slot.text ?? slot.display)));
              }}
              onKeyDown={(event) => {
                if (readOnly || editing || slot.operators || event.ctrlKey || event.metaKey || event.altKey) return;
                if (event.key === '(' && !slot.placeholder && !slot.switchMatch) {
                  event.preventDefault();
                  commit(slot, '(' + (slot.text ?? slot.display) + ')');
                } else if (event.key.length === 1 && event.key !== ' ') {
                  event.preventDefault();
                  beginEdit({ slot, text: event.key, raw: false });
                }
              }}
            >
              <span className={statement ? 'min-w-0 whitespace-normal wrap-anywhere' : 'truncate'}>
                {slot.content ??
                  (!slot.placeholder && slot.display === source.slice(slot.range.from, slot.range.to)
                    ? syntaxSlice(slot.range)
                    : slot.display)}
              </span>
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
              readOnly={readOnly}
              onInspectReference={onInspectReference}
              onCloseEmpty={() => close()}
              choose={(action) => {
                if (readOnly) return;
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
  const textBetween = (from: number, to: number) => {
    const text = source.slice(from, to).trim();
    if (!text) return null;
    const hasComment = comments.some((comment) => comment.offset >= from && comment.end <= to);
    const start = source.indexOf(text, from);
    return (
      <span className={hasComment ? 'whitespace-pre-line wrap-anywhere' : 'whitespace-normal wrap-anywhere'}>
        {syntaxSlice({ from: start, to: start + text.length })}
      </span>
    );
  };

  function renderNode(
    node: ExpressionNode,
    depth: number,
    argument?: string,
    parent?: ExpressionNode,
    groupDepth = 0
  ): ReactNode {
    const ast = expressionNodeSource(node);
    const member = isConstructorKeyValuePair(ast?.$container) ? ast.$container.key.$refText : undefined;
    const slotHint = placeholderHint(ast);
    const hint = argument ?? member ?? slotHint?.hint;
    const operandLabel = argument ? argument + ' argument' : member ? member + ' value' : undefined;
    const range = regionOf(node, whole);
    const path = relativePath(ast) || 'root';
    const original = source.slice(range.from, range.to);
    const target = targetAt(node, range);
    const placeholder = isPlaceholder(node, original);
    const argumentIndex = parent?.$type === 'RosettaSymbolReference' ? ast?.$containerIndex : undefined;
    const compositionArgumentIndex = ast?.$container === compositionCall ? argumentIndex : undefined;
    const replace = (text: string) => {
      const { parsed } = parseExpressionDraft(text);
      const ast = parsed.hasErrors ? undefined : parsed.value;
      const grouped =
        depth > 0 &&
        (argumentIndex === undefined || ast?.$type === 'SwitchOperation') &&
        needsOperandGrouping(ast, text);
      return update(range, grouped ? '(' + text + ')' : text);
    };
    const isMemberPath = ast?.$type === 'RosettaFeatureCall' || ast?.$type === 'RosettaDeepFeatureCall';
    const callSignature =
      node.$type === 'RosettaSymbolReference'
        ? scope.references?.find((entry) => entry.kind === 'callable' && entry.name === node.symbol)
        : undefined;
    const argumentNames =
      ast && ast === compositionCall
        ? (compositionArgumentNames ?? callSignature?.argumentNames)
        : callSignature?.argumentNames;
    const children = isMemberPath
      ? []
      : getChildren(node)
          .flatMap((child) => {
            const childAst = expressionNodeSource(child);
            if (!childAst) return [];
            const container = childAst.$container;
            return [
              {
                node: child,
                range: getNodeSourceRegion(childAst),
                memberLabel: isConstructorKeyValuePair(container)
                  ? getConstructorMemberLabelRegion(container)
                  : undefined,
                switchCase: isSwitchCaseOrDefault(container) ? container : undefined,
                body: expressionBody(childAst)
              }
            ];
          })
          .filter((child) => child.range.from >= range.from && child.range.to <= range.to)
          .sort((a, b) => a.range.from - b.range.from);
    const missing = readOnly
      ? 0
      : Math.max(0, (argumentNames?.length ?? callSignature?.argumentCount ?? 0) - children.length);
    const leaf = !children.length && !missing;
    const repeatedOperator =
      ast &&
      'operator' in ast &&
      associativeOperators.has(String(ast.operator)) &&
      parent &&
      parent.$type === node.$type &&
      'operator' in parent &&
      parent.operator === ast.operator;
    const grouping = Boolean(
      !placeholder &&
      !repeatedOperator &&
      (children.length ||
        missing ||
        callSignature ||
        ast?.$type === 'RosettaConstructorExpression' ||
        ast?.$type === 'ListLiteral' ||
        ast?.$type === 'RosettaSuperCall' ||
        (ast?.$type === 'RosettaSymbolReference' && ast.explicitArguments) ||
        (ast && 'operator' in ast))
    );
    const canCollapse = grouping && !leaf;
    const isCollapsed = canCollapse && collapsed.has(path);
    const subject =
      ast?.$type === 'RosettaConstructorExpression' && ast.typeRef.$type === 'RosettaSymbolReference'
        ? ast.typeRef.symbol.$refText
        : (callSignature?.name ?? expressionGroupLabel(ast));
    const disclosureLabel = (isCollapsed ? 'Expand ' : 'Collapse ') + subject;
    const clause = ast && expressionBody(ast);
    // A required clause and its value clear the same range. Give that action to the clause.
    const removeGroup =
      grouping && !readOnly && !editing && clause !== 'then' && clause !== 'callback' && clause !== 'fallback'
        ? () => clearValue(range, path)
        : undefined;
    const renderGroup = (content: ReactNode) => (
      <ExpressionSection
        as="span"
        key={path}
        label={operandLabel ?? (grouping ? expressionGroupLabel(ast) : undefined)}
        title={operandLabel}
        onRemove={removeGroup}
        data-expression-group={grouping ? node.$type : undefined}
        data-expression-group-depth={grouping ? groupDepth : undefined}
        className={
          grouping
            ? 'relative inline-flex min-h-7 min-w-0 max-w-full flex-wrap items-baseline gap-1 rounded border border-border py-0.5 ps-1 ' +
              (canCollapse && !isCollapsed ? 'pe-8 has-[>[data-expression-remove]]:pe-14 ' : '') +
              groupSurfaces[Math.min(groupDepth, groupSurfaces.length - 1)]
            : operandLabel
              ? 'inline-flex min-w-0 max-w-full flex-wrap items-baseline gap-1'
              : 'contents'
        }
      >
        {canCollapse && (
          <Button
            type="button"
            variant={isCollapsed ? 'outline' : 'ghost'}
            size={isCollapsed ? 'xs' : 'icon-xs'}
            className={
              isCollapsed ? undefined : 'absolute top-0.5 text-muted-foreground ' + (removeGroup ? 'end-7' : 'end-1')
            }
            aria-label={disclosureLabel}
            data-expression-disclosure
            aria-expanded={!isCollapsed}
            title={disclosureLabel}
            onClick={() =>
              setCollapsed((previous) => {
                const next = new Set(previous);
                if (!next.delete(path)) next.add(path);
                return next;
              })
            }
          >
            {isCollapsed ? <ChevronDown aria-hidden="true" /> : <ChevronUp aria-hidden="true" />}
            {isCollapsed && disclosureLabel}
          </Button>
        )}
        {content}
      </ExpressionSection>
    );
    if (leaf) {
      const memberPath = isMemberPath ? presentMemberPath(ast, range) : undefined;
      const display = memberPath?.text ?? original;
      const reference =
        isMemberPath || ast?.$type === 'RosettaSymbolReference' || ast?.$type === 'RosettaImplicitVariable';
      const label =
        operandLabel ??
        (placeholder ? (slotHint?.label ?? 'Add expression') : (readOnly ? 'Inspect ' : 'Edit ') + display);
      const slot = renderSlot({
        id: path,
        argumentIndex: compositionArgumentIndex,
        parameterName: argument,
        reference: reference && !placeholder,
        range,
        target,
        replace,
        placeholder,
        display: placeholder ? (hint ?? 'Add expression') : display,
        content: memberPath?.content,
        text: memberPath ? original : undefined,
        label: operandLabel && !placeholder ? label + ' ' + display : label
      });
      return grouping ? renderGroup(slot) : slot;
    }

    const reference =
      ast?.$type === 'RosettaSymbolReference' && (ast.explicitArguments || missing || argumentNames?.length)
        ? getSymbolReferenceRegions(ast)
        : undefined;
    const constructor =
      ast?.$type === 'RosettaConstructorExpression' && ast.typeRef.$type === 'RosettaSymbolReference'
        ? getSymbolReferenceRegions(ast.typeRef)?.name
        : undefined;
    const callee =
      (argumentNames?.length || onInspectReference ? reference?.name : undefined) ??
      (onInspectReference ? constructor : undefined);
    const explicitArguments = ast?.$type === 'RosettaSymbolReference' && ast.explicitArguments;
    const calleeName = callee && source.slice(callee.from, callee.to);
    const showParameters = callee && expandedParameters.has(path);
    const property = ast && getExpressionOperatorRegion(ast);
    const operators = alternatives(node);
    const syntax = (from: number, to: number) => {
      if (from >= to) return null;
      if (callee && callee.from >= from && callee.to <= to) {
        return (
          <>
            {textBetween(from, callee.from)}
            <PickerTrigger
              indicator={false}
              className={expressionControl}
              aria-label={
                (argumentNames?.length
                  ? showParameters
                    ? 'Hide parameters for '
                    : 'Show parameters for '
                  : 'Inspect ') + calleeName
              }
              aria-expanded={argumentNames?.length ? Boolean(showParameters) : undefined}
              data-expression-parameters
              onClick={(event) => {
                inspectAt(target, event.currentTarget);
                if (argumentNames?.length)
                  setExpandedParameters((previous) => {
                    const next = new Set(previous);
                    if (next.has(path)) next.delete(path);
                    else next.add(path);
                    return next;
                  });
              }}
            >
              <span className="truncate">{syntaxSlice(callee)}</span>
            </PickerTrigger>
            {textBetween(callee.to, to)}
          </>
        );
      }
      if (!property || property.from < from || property.to > to) return textBetween(from, to);
      const word = source.slice(property.from, property.to);
      const predicate = node.$type === 'RosettaConditionalExpression' && children[0];
      if (!operators.length && !predicate) return textBetween(from, to);
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
          {textBetween(from, gap.from)}
          {renderSlot(operatorSlot, 'operator')}
          {textBetween(gap.to, to)}
        </>
      );
    };
    const memberRows =
      node.$type === 'RosettaConstructorExpression' &&
      children.length > 1 &&
      children.every(({ memberLabel, range }) => memberLabel && memberLabel.to <= range.from);
    const addSwitchCase =
      !readOnly && ast?.$type === 'SwitchOperation'
        ? () => {
            const draftCase = SWITCH_GUARD_HOLE + ' then ' + hole;
            const fallback = ast.cases.find((entry) => !entry.guard);
            if (fallback) {
              const { from } = getNodeSourceRegion(fallback);
              update({ from, to: from }, draftCase + ', ');
            } else {
              const finalCase = ast.cases.at(-1);
              if (finalCase) {
                const { to } = getNodeSourceRegion(finalCase);
                update({ from: to, to }, ', ' + draftCase);
              }
            }
          }
        : undefined;
    let cursor = memberRows ? children.at(-1)!.range.to : range.from;
    const insertion = missing ? reference?.argumentInsertion : undefined;
    const suffix = insertion ?? range.to;
    const renderedChildren =
      isCollapsed || memberRows
        ? []
        : children.map((child, index) => {
            const { body, switchCase } = child;
            const guard = switchCase?.guard;
            const matchRange = guard && getNodeSourceRegion(guard);
            const match = matchRange && source.slice(matchRange.from, matchRange.to);
            const gapStart = switchCase
              ? getNodeSourceRegion(switchCase).from
              : body === 'callback' || body === 'fallback'
                ? child.range.from
                : cursor;
            const prefix = syntax(cursor, gapStart);
            const gap =
              guard && matchRange && match && matchRange.from >= gapStart && matchRange.to <= child.range.from ? (
                <>
                  {syntax(gapStart, matchRange.from)}
                  {renderSlot(
                    {
                      id: relativePath(guard),
                      label: match === SWITCH_GUARD_HOLE ? 'Add case match' : 'Edit case match ' + match,
                      display: match === SWITCH_GUARD_HOLE ? 'Match' : match,
                      placeholder: match === SWITCH_GUARD_HOLE,
                      switchMatch: true,
                      range: matchRange,
                      target,
                      replace: (text) => update(matchRange, text)
                    },
                    'operator'
                  )}
                  {textBetween(matchRange.to, child.range.from)}
                </>
              ) : body === 'default' ? (
                <span className="border border-transparent ps-1.5">{textBetween(gapStart, child.range.from)}</span>
              ) : (
                syntax(gapStart, child.range.from)
              );
            // Keep a case's delimiter beside its result and the switch operator beside its selector.
            const nextCase = switchCase && children[index + 1]?.switchCase;
            cursor = nextCase ? getNodeSourceRegion(nextCase).from : child.range.to;
            const parameter = argumentNames?.[index];
            const showName =
              showParameters && parameter && !isPlaceholder(child.node, source.slice(child.range.from, child.range.to));
            const content = (
              <>
                {showName && (
                  <span className="text-caption wrap-anywhere" aria-hidden="true">
                    {parameter}:
                  </span>
                )}
                {renderNode(child.node, depth + 1, parameter, node, groupDepth + (grouping ? 1 : 0))}
              </>
            );
            if (body) {
              const label =
                body === 'case'
                  ? match === SWITCH_GUARD_HOLE
                    ? 'unfilled case'
                    : 'case ' + match
                  : body === 'default'
                    ? 'default case'
                    : branchLabels[body];
              const childPath = relativePath(expressionNodeSource(child.node));
              const removable = switchCase
                ? switchCase.$container.cases.length > 1
                : body === 'else' || !isPlaceholder(child.node, source.slice(child.range.from, child.range.to));
              const removeClause =
                !readOnly && !editing && removable
                  ? () => {
                      if (switchCase) {
                        const edit = getSwitchCaseRemoval(source, switchCase);
                        if (edit) remove(edit.region, edit.replacement, path, path + '/operator');
                      } else if (body === 'else' && ast?.$type === 'RosettaConditionalExpression') {
                        const from = getNodeSourceRegion(ast.ifthen).to;
                        remove(
                          { from, to: child.range.to },
                          retainCommentTrivia(source.slice(from, child.range.to)),
                          childPath,
                          path + '/operator'
                        );
                      } else {
                        clearValue(child.range, childPath);
                      }
                    }
                  : undefined;
              return (
                <Fragment key={child.range.from}>
                  {switchCase && prefix ? (
                    <span
                      className={
                        'inline-flex min-w-0 max-w-full flex-wrap items-baseline gap-1 border-transparent ' +
                        switchRowInset
                      }
                    >
                      {prefix}
                    </span>
                  ) : (
                    prefix
                  )}
                  <ExpressionSection
                    as="span"
                    data-expression-body={body}
                    label={label}
                    onRemove={removeClause}
                    className={
                      'flex min-w-0 max-w-full flex-wrap items-baseline gap-1' +
                      (switchCase
                        ? ' self-stretch rounded border-border py-0.5 pe-1 ' + switchRowInset
                        : ' basis-full rounded border border-border py-0.5 ps-2')
                    }
                  >
                    {gap}
                    {content}
                    {textBetween(child.range.to, cursor)}
                  </ExpressionSection>
                </Fragment>
              );
            }
            return (
              <Fragment key={child.range.from}>
                {gap}
                <span
                  className={
                    showName
                      ? 'inline-flex min-w-0 flex-wrap items-baseline gap-1'
                      : node.$type === 'ListLiteral'
                        ? 'rune-expression-list-item'
                        : 'contents'
                  }
                >
                  {content}
                </span>
              </Fragment>
            );
          });
    const switchSelector = addSwitchCase && !children[0]?.switchCase ? renderedChildren.shift() : undefined;
    const content = !isCollapsed && (
      <>
        {memberRows ? (
          <>
            {syntax(range.from, children[0]!.memberLabel!.from)}
            <span
              className="grid w-full min-w-0 grid-cols-[fit-content(40%)_minmax(0,1fr)] items-baseline gap-x-2 gap-y-1 ps-2"
              data-expression-members
            >
              {children.map((child, index) => {
                const label = child.memberLabel!;
                return (
                  <Fragment key={label.from}>
                    {textBetween(label.from, label.to)}
                    <span className="inline-flex min-w-0 flex-wrap items-baseline gap-1">
                      {textBetween(label.to, child.range.from)}
                      {renderNode(child.node, depth + 1, undefined, node, groupDepth + 1)}
                      {textBetween(child.range.to, children[index + 1]?.memberLabel?.from ?? child.range.to)}
                    </span>
                  </Fragment>
                );
              })}
            </span>
          </>
        ) : addSwitchCase ? (
          <>
            {switchSelector && (
              <span className="inline-flex min-w-0 max-w-full flex-wrap items-baseline gap-1">{switchSelector}</span>
            )}
            <span
              data-expression-switch-clauses
              className="inline-flex min-w-0 max-w-full flex-col items-start gap-1 border-s border-border ps-2"
            >
              {renderedChildren}
              <Button
                type="button"
                size="xs"
                variant="ghost"
                aria-label="Add switch case"
                disabled={Boolean(editing)}
                onClick={addSwitchCase}
              >
                + Case
              </Button>
            </span>
          </>
        ) : (
          renderedChildren
        )}
        {syntax(cursor, suffix)}
        {insertion !== undefined && (
          <>
            {!explicitArguments && '('}
            {Array.from({ length: missing }, (_, index) => {
              const position = children.length + index;
              const name = argumentNames?.[position] ?? 'Argument ' + (position + 1);
              return (
                <span className="contents" key={name}>
                  {position > 0 && ', '}
                  {renderSlot({
                    id: path + '/missing/' + index,
                    argumentIndex: ast === compositionCall ? position : undefined,
                    parameterName: name,
                    label: name + ' argument',
                    display: name,
                    target: targetAt(node, range, position),
                    range,
                    placeholder: true,
                    replace: (text) => {
                      const additions = Array.from({ length: missing }, (_, offset) =>
                        offset === index ? text : hole
                      ).join(', ');
                      const insert = explicitArguments
                        ? (children.length ? ', ' : '') + additions
                        : '(' + additions + ')';
                      return update({ from: insertion, to: insertion }, insert);
                    }
                  })}
                </span>
              );
            })}
            {!explicitArguments && ')'}
          </>
        )}
        {syntax(suffix, range.to)}
        {!readOnly &&
          compositionArgumentIndex !== undefined &&
          renderSlot({
            id: path + '/actions',
            argumentIndex: compositionArgumentIndex,
            parameterName: argument,
            label: (argument ?? 'Argument ' + (compositionArgumentIndex + 1)) + ' argument actions',
            display: '…',
            text: original,
            target,
            range,
            replace
          })}
      </>
    );
    return renderGroup(content);
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
  const rootSlot: SlotControl = {
    id: 'root/actions',
    label: statementTrigger?.label ?? 'Expression actions',
    display: statementTrigger?.label ?? '…',
    content: statementTrigger?.content,
    text: source,
    range: whole,
    target: targetAt(tree, rootRegion),
    replace: (text) => update(whole, text)
  };
  const rootEdit = statementTrigger && editing?.slot.id === rootSlot.id ? editing : undefined;
  return (
    <div
      ref={root}
      className="rune-inline-expression flex w-full min-w-0 max-w-full flex-wrap items-baseline gap-1 font-code text-xs font-book"
      data-testid="inline-expression-builder"
      aria-label="Expression"
      onKeyDown={moveFocus}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onBlur?.();
      }}
    >
      {statementTrigger && renderSlot(rootSlot, 'statement')}
      {rootEdit ? renderEdit(rootEdit) : renderNode(tree, 0)}
      {!readOnly && !statementTrigger && getChildren(tree).length > 0 && renderSlot(rootSlot)}
      {editing && !editingRendered && !rootEdit && renderEdit(editing)}
      {error && (
        <span role="alert" className="text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}
