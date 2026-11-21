// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Daikonic contributors
import { SourceSaveControl } from '../editing/SourceSaveControl.js';
import { useWorkspaceActionsOptional } from '../../shell/perspectives/workspace-actions-context.js';
import { NativeSelect } from '@rune-langium/design-system/ui/select';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { undo, undoDepth } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import type { DockviewApi } from 'dockview-react';
import { ReactFlowProvider, useReactFlow, type Connection, type XYPosition } from '@xyflow/react';
import {
  hasCompositionAnnotation,
  getCompositionCallExpression,
  EXPRESSION_DRAFT_HOLE,
  findExpressionOwner,
  getExpressionRows,
  getFunctionAliasInsertion,
  getFunctionImplementationRegion,
  getNodeSourceRegion,
  isRosettaFunction,
  namespaceFromModelName,
  parseExpression,
  parseExpressionDraft,
  type CompositionStep,
  type ExpressionRow,
  type FunctionComposition,
  type RosettaModel,
  type SourceRegion
} from '@rune-langium/core';
import {
  selectNodeRepository,
  useEditorStore,
  useLatestRef,
  expressionScopeFromEntries,
  type ExpressionSlot,
  type FunctionScope,
  makeNodeId,
  qualifiedNameFromNodeId,
  formatCardinality,
  parseCardinality,
  createExpressionStarter
} from '@rune-langium/visual-editor';
import { Button } from '@rune-langium/design-system/ui/button';
import { Input, SearchInput } from '@rune-langium/design-system/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@rune-langium/design-system/ui/tabs';
import { ArrowLeft, Plus, Workflow, Code, Network, ArrowUpRight } from 'lucide-react';
import { requestExpressionScope, requestFunctionComposition } from '../../services/workspace.js';
import {
  compositionReference,
  compositionCallText,
  buildAliasEdit,
  compositionInputText,
  compositionAliasEdit,
  compositionExpressionEdit,
  compositionArgumentsText,
  compositionCandidate,
  compositionSourceEdit,
  reorderCompositionVariables,
  compositionBindingCycle
} from '../../services/composition-edit.js';
import { applyExpressionDocumentEdit, type DocumentBinding } from '../../services/expression-document.js';
import { setExpressionHighlight } from '../../lang/source-navigation-highlight.js';
import { usePerspectiveStore } from '../../store/perspective-store.js';
import { useComposeNavigationStore } from '../../store/compose-navigation-store.js';
import { usePreviewSession } from '../../shell/providers/preview-session-context.js';
import { SplitWorkbench } from '../../shell/SplitWorkbench.js';
import { ComposeWorkbench } from './ComposeWorkbench.js';
import { WorkbenchViewBar, WorkbenchPaneHeading } from '../../shell/WorkbenchChrome.js';
import { PerspectiveHeading } from '../../shell/perspectives/PerspectiveHeading.js';
import { ExpressionWorkspace, type ExpressionWorkspaceProps } from '../editing/ExpressionWorkspace.js';
import { InlineExpressionRows } from '../editing/InlineExpressionRows.js';
import { WorkflowFunctionBuilder } from '../WorkflowFunctionBuilder.js';
import { readWorkflows } from '@rune-langium/project-config';
import { useProject } from '../../shell/providers/project-context.js';
import { pathToUri } from '../../utils/uri.js';
import { withInstrumentation } from '../../services/instrumentation/core.js';
import './function-composer.css';

import {
  NodeBindingContext,
  VARIABLE_MIME,
  type ComposerNode,
  type CompositionVariable,
  type NodeArgument,
  type NodeBindingActions
} from './CompositionNode.js';
import {
  COMPOSITION_PRIMITIVES,
  findCompositionPrimitive,
  type CompositionPrimitiveId
} from './composition-primitives.js';
import { FunctionPalette, COMPOSITION_FUNCTION_MIME as MIME } from './FunctionPalette.js';
const PRIMITIVE_MIME = 'application/x-rune-composition-primitive';
const centerStackWidth = 600;
import { CompositionCanvas, DRAFT_NODE, type SavedCompositionViewport } from './CompositionCanvas.js';
import { compositionProducerId as producerId, type CompositionWiring } from './composition-graph.js';

export interface FunctionComposerProps {
  workspaceKey: string;
  models: readonly RosettaModel[];
  editor?: ExpressionWorkspaceProps;
  inspector: ReactNode;
  active: boolean;
  onNavigate(nodeId: string): void;
  onSave(): Promise<void>;
}
interface Draft {
  binding: DocumentBinding;
  dependencies?: ExpressionWorkspaceProps['dependencySnapshot'];
  region: SourceRegion;
  scopeRegion?: SourceRegion;
  expression: string;
  sourceCall?: { text: string; arguments: SourceRegion[]; collection?: SourceRegion };
  expressionType?: CompositionStep['expressionType'];
  name: string;
  stepId?: string;
  adding?: boolean;
  callee?: string;
  argumentRegions?: SourceRegion[];
  arguments?: NodeArgument[];
  outputBinding?: { variableId?: string; name?: string };
  position?: XYPosition;
  bindingOnly?: boolean;
  sourceOnly?: boolean;
  inputVariable?: string;
  collectionBinding?: { region: SourceRegion; value: string };
}

/** One mounted instance per workspace: graph positions and uncommitted leaf drafts survive navigation. */
export const FunctionComposer = withInstrumentation(
  function FunctionComposer(props: FunctionComposerProps) {
    return (
      <ReactFlowProvider>
        <Composer {...props} />
      </ReactFlowProvider>
    );
  },
  { op: 'FunctionComposer', capture: 0 }
);
function Composer({ workspaceKey, models, editor, inspector, active, onNavigate, onSave }: FunctionComposerProps) {
  const creating = useComposeNavigationStore((s) => s.creating);
  const setCreating = useComposeNavigationStore((s) => s.setCreating);
  const nodesById = useEditorStore((s) => s.nodesById);
  const repository = useMemo(() => selectNodeRepository(nodesById), [nodesById]);
  const compositionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const model of models) {
      const namespace = namespaceFromModelName(model.name) ?? '';
      for (const element of model.elements) {
        if (isRosettaFunction(element) && hasCompositionAnnotation(element))
          ids.add(makeNodeId(namespace, element.name, element.$type));
      }
    }
    return ids;
  }, [models]);
  const [portContext, setPortContext] = useState<string>();
  const [discover, setDiscover] = useState(false);
  const [variablesOpen, setVariablesOpen] = useState(false);
  const [variableQuery, setVariableQuery] = useState('');
  const [selectedVariable, setSelectedVariable] = useState<string>();
  const [applyBusy, setApplyBusy] = useState(false);
  const [query, setQuery] = useState('');
  const matchingPrimitives = COMPOSITION_PRIMITIVES.filter((primitive) =>
    `${primitive.label} ${primitive.description}`.toLowerCase().includes(query.trim().toLowerCase())
  );
  const primitiveGroups = [...new Set(matchingPrimitives.map((primitive) => primitive.group))];
  const dock = useRef<DockviewApi | undefined>(undefined);
  const paletteSearch = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<'step' | 'signature'>('step');
  const [viewPreferences, setViewPreferences] = useState<Record<string, { source: boolean; canvas: boolean }>>({});
  const [selected, setSelected] = useState('return');
  const [focusId, setFocusId] = useState<string>();
  const [facts, setFacts] = useState<{
    source: string;
    nodeId: string;
    dependencies: ExpressionWorkspaceProps['dependencySnapshot'];
    value: FunctionComposition;
  }>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [canvasElement, setCanvasElement] = useState<HTMLElement | null>(null);
  const [vertical, setVertical] = useState(true);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!canvasElement) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry || entry.contentRect.width <= 0 || entry.contentRect.height <= 0) return;
      const { width, height } = entry.contentRect;
      setVertical(width < 1000);
      setCanvasSize((previous) =>
        previous.width === width && previous.height === height ? previous : { width, height }
      );
    });
    observer.observe(canvasElement);
    return () => observer.disconnect();
  }, [canvasElement]);
  const [draft, setDraft] = useState<Draft>();
  const drafts = useRef(new Map<string, Draft>());
  const viewports = useRef(new Map<string, SavedCompositionViewport>());
  const positions = useRef(new Map<string, Map<string, XYPosition>>());
  const [breadcrumbs, setBreadcrumbs] = useState<string[]>([]);
  const selections = useRef(new Map<string, string>());
  const client = usePreviewSession();
  const project = useProject();
  const flow = useReactFlow<ComposerNode>();
  const current = useLatestRef(editor);
  const identity = editor?.nodeId ?? '';
  const viewPreference = viewPreferences[identity] ?? { source: Boolean(identity), canvas: !identity };
  const { source, canvas: canvasOpen } = viewPreference;
  const setSource = (source: boolean) =>
    setViewPreferences((all) => ({ ...all, [identity]: { ...viewPreference, source } }));
  const setCanvasOpen = (canvas: boolean) =>
    setViewPreferences((all) => ({ ...all, [identity]: { ...viewPreference, canvas } }));
  const [sourceHost] = useState(() => document.createElement('div'));
  const runeView = useRef<EditorView>(null);
  const [sourceFocus, setSourceFocus] = useState<{ from: number; argument?: number }>();
  const [activeSlot, setActiveSlot] = useState<ExpressionSlot>();
  const [inlineEditing, setInlineEditing] = useState(false);
  const [linkedScope, setLinkedScope] = useState<{ owner: string; value: FunctionScope }>();
  const [codeHover, setCodeHover] = useState<SourceRegion>();
  const attachSource = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) {
        sourceHost.remove();
        return;
      }
      node.append(sourceHost);
      runeView.current?.requestMeasure();
    },
    [sourceHost]
  );
  const recipe = useMemo(
    () =>
      project.snapshot
        ? readWorkflows(project.snapshot).workflows.find(
            (entry) =>
              entry.function && `${entry.function.namespace}.${entry.function.name}#RosettaFunction` === identity
          )
        : undefined,
    [project.snapshot, identity]
  );
  const viewKey = `${identity}:${vertical ? 'TB' : 'LR'}`;
  const file = editor?.file;
  const request = useRef(0);
  const [createdId, setCreatedId] = useState<string>();
  useEffect(() => {
    if (!createdId || !nodesById.has(createdId)) return;
    if (editor?.nodeId === createdId) setCreatedId(undefined);
    else onNavigate(createdId);
  }, [createdId, nodesById, onNavigate, editor?.nodeId]);
  useEffect(() => {
    setDraft(drafts.current.get(identity));
    setActiveSlot(undefined);
    setInlineEditing(false);
    setSourceFocus(undefined);
    setSelected(selections.current.get(identity) ?? drafts.current.get(identity)?.stepId ?? 'return');
    setPortContext(undefined);
    setSelectedVariable(undefined);
    setError(undefined);
  }, [identity]);
  useEffect(() => {
    if (!active || !editor?.file || !editor.parseCurrent || creating) return;
    const captured = editor;
    const version = ++request.current;
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    void requestFunctionComposition(editor.file.path, identity, editor.dependencySnapshot ?? [editor.file], discover)
      .then((value) => {
        if (
          !cancelled &&
          current.current?.nodeId === captured.nodeId &&
          current.current?.file?.content === captured.file?.content &&
          current.current?.dependencySnapshot === captured.dependencySnapshot
        )
          setFacts({
            source: captured.file!.content,
            nodeId: identity,
            dependencies: captured.dependencySnapshot,
            value
          });
      })
      .catch((failure) => {
        if (!cancelled) setError(failure instanceof Error ? failure.message : 'Could not load the composition.');
      })
      .finally(() => {
        if (!cancelled && version === request.current) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active, identity, file?.content, editor?.parseCurrent, editor?.dependencySnapshot, creating, retry, discover]);
  const composition =
    facts?.nodeId === identity &&
    facts.source === file?.content &&
    facts.dependencies === editor?.dependencySnapshot &&
    editor?.parseCurrent
      ? facts.value
      : undefined;
  // Keep the last graph mounted during a reparse. Only current facts permit editing.
  const linkedGraph = composition ?? (facts?.nodeId === identity ? facts.value : undefined);
  // An alias that normally folds into its producer needs a node while its own expression is being edited.
  const presented = useMemo(() => {
    if (!linkedGraph?.steps.some((step) => step.id === draft?.stepId && step.variableSource)) return linkedGraph;
    return {
      ...linkedGraph,
      steps: linkedGraph.steps.map((step) =>
        step.id === draft?.stepId ? { ...step, variableSource: undefined } : step
      )
    };
  }, [linkedGraph, draft?.stepId]);
  const presentedSource = facts?.nodeId === identity ? facts.source : (file?.content ?? '');
  const writable = Boolean(composition?.supported && file && !file.readOnly && !file.refOnly && !editor?.readOnly);
  const owner = useMemo(() => {
    if (!editor?.parsed || !editor.parseCurrent) return undefined;
    const found = findExpressionOwner(editor.parsed.model, {
      name: identity.split('#')[0]!.split('.').at(-1)!,
      kind: 'RosettaFunction'
    });
    return found && isRosettaFunction(found) ? found : undefined;
  }, [editor?.parsed, editor?.parseCurrent, identity]);
  const rows = useMemo(() => (owner ? getExpressionRows(owner) : []), [owner]);
  const sourceEditable = Boolean(composition && owner && file && !file.readOnly && !file.refOnly && !editor?.readOnly);
  useEffect(() => {
    if (!source || !rows.length || !file || !editor?.dependencySnapshot) return;
    let cancelled = false;
    void requestExpressionScope(file.path, identity, rows[0]!.region, editor.dependencySnapshot)
      .then((entries) => {
        if (!cancelled) setLinkedScope({ owner: identity, value: expressionScopeFromEntries(entries) });
      })
      .catch(() => {
        /* Each open picker can retry against the current source. */
      });
    return () => {
      cancelled = true;
    };
  }, [source, rows, file?.path, identity, editor?.dependencySnapshot]);
  useEffect(() => {
    if (!composition || draft) return;
    const id = producerId(selected, composition.steps);
    if (id !== selected) {
      setSelected(id);
      selections.current.set(identity, id);
    }
  }, [composition, selected, draft, identity]);
  const preview = useMemo(() => {
    if (!draft?.adding || !draft.stepId) return undefined;
    const step: CompositionStep = {
      id: draft.stepId!,
      name: draft.name,
      kind: draft.callee ? 'call' : 'expression',
      expressionType: draft.expressionType,
      dependencies: [],
      region: draft.region,
      call: draft.callee
        ? {
            identity: qualifiedNameFromNodeId(draft.callee),
            region: draft.region,
            arguments: [],
            inputs:
              draft.arguments?.map((argument) => ({
                name: argument.name,
                type: argument.type ?? '',
                cardinality: argument.cardinality
              })) ?? []
          }
        : undefined
    };
    return { step, expression: draft.expression, position: draft.position };
  }, [draft]);
  const selectedStep = preview?.step ?? presented?.steps.find((step) => step.id === selected);
  const variables = useMemo<CompositionVariable[]>(() => {
    const locals = selectedStep?.locals ?? [];
    return [
      ...locals.map((name) => ({
        id: `local:${selectedStep!.id}:${name}`,
        name,
        reference: name === 'item' ? 'item' : compositionReference(name),
        kind: 'local' as const,
        producer: selectedStep!.id
      })),
      ...(presented?.steps
        .filter((step) => !locals.includes(step.name))
        .map((step) => ({
          id: step.id,
          name: step.name,
          reference: compositionReference(step.name),
          kind:
            step.kind === 'input'
              ? ('input' as const)
              : step.kind === 'return'
                ? ('output' as const)
                : ('variable' as const),
          producer: producerId(step.id, presented.steps),
          type: step.parameter?.type,
          cardinality: step.parameter?.cardinality
        })) ?? [])
    ];
  }, [presented, selectedStep?.id, selectedStep?.locals]);
  const changeDraft = (value: Draft | undefined) => {
    if (value) drafts.current.set(identity, value);
    else drafts.current.delete(identity);
    setDraft(value);
    setActiveSlot(undefined);
  };
  const capture = () =>
    file && editor?.documents.capture(pathToUri(file.path), identity, { from: 0, to: file.content.length });
  const makeDraft = (step: CompositionStep): Draft | undefined => {
    if (applyBusy) return;
    if (draft?.stepId === step.id) return draft;
    if (draft) {
      setError('Apply or discard the current node draft first.');
      return;
    }
    const canonical = composition?.steps.find((candidate) => candidate.id === step.id);
    if (!canonical?.region || !writable) return;
    const region = canonical.region;
    const binding = capture();
    if (!binding || binding.source !== file?.content) {
      setError('The source is updating. Try this edit again once the current source is ready.');
      return;
    }
    step = canonical;
    return {
      binding,
      dependencies: editor?.dependencySnapshot,
      region,
      name: step.name,
      stepId: step.id,
      expression: binding.source.slice(region.from, region.to),
      ...(step.call && step.call.arguments.length === step.call.inputs.length
        ? {
            callee: `${step.call.identity}#RosettaFunction`,
            argumentRegions: step.call.arguments,
            arguments: step.call.inputs.map((input, index) => ({
              name: input.name,
              type: input.type,
              cardinality: input.cardinality,
              mode: step.call!.argumentVariables?.[index] ? ('variable' as const) : ('value' as const),
              variableId: step.call!.argumentVariables?.[index],
              value: binding.source.slice(step.call!.arguments[index]!.from, step.call!.arguments[index]!.to)
            }))
          }
        : {})
    };
  };
  const changeSource = (row: ExpressionRow | undefined, text: string) => {
    if (!sourceEditable || !editor || applyBusy || stale) return;
    const sameRow = !row ? draft?.adding : draft?.region.from === row.region.from && draft?.region.to === row.region.to;
    if (draft && !sameRow) {
      setError('Apply or discard the current expression first.');
      return;
    }
    const step =
      row && composition?.supported
        ? composition.steps.find((entry) => entry.region?.from === row.region.from && entry.region.to === row.region.to)
        : undefined;
    const binding = capture();
    const next =
      draft ??
      (step
        ? makeDraft(step)
        : row && binding
          ? {
              binding,
              dependencies: editor.dependencySnapshot,
              name: row.kind,
              region: row.region,
              expression: text,
              sourceOnly: true
            }
          : undefined);
    if (!next) return;
    setError(undefined);
    if (step) {
      setSelected(step.id);
      selections.current.set(identity, step.id);
    }
    const parsed = next.callee ? parseExpressionDraft(text).parsed : undefined;
    const root = parsed && !parsed.hasErrors ? parsed.value : undefined;
    const call = root && getCompositionCallExpression(root);
    if (
      call &&
      next.arguments?.length === call.rawArgs.length &&
      [qualifiedNameFromNodeId(next.callee!), qualifiedNameFromNodeId(next.callee!).split('.').pop()].includes(
        call.symbol.$refText
      )
    ) {
      const regions = call.rawArgs.map(getNodeSourceRegion);
      const arguments_ = regions.map((region, index) => {
        const argumentText = text.slice(region.from, region.to);
        const value = argumentText === EXPRESSION_DRAFT_HOLE ? '' : argumentText;
        const previous = next.arguments![index]!;
        const parameter = variables.find(
          (entry) => entry.reference === value && entry.kind !== 'output' && entry.producer !== step?.id
        );
        return {
          ...previous,
          value,
          variableId: parameter?.id,
          mode: parameter ? ('variable' as const) : ('value' as const)
        };
      });
      const collection =
        root?.$type === 'MapOperation' && root.argument ? getNodeSourceRegion(root.argument) : undefined;
      const inputVariable = collection
        ? variables.find(
            (entry) =>
              entry.reference === text.slice(collection.from, collection.to) &&
              entry.kind !== 'output' &&
              entry.producer !== step?.id
          )?.id
        : undefined;
      changeDraft({
        ...next,
        arguments: arguments_,
        expression: text,
        sourceCall: {
          text,
          arguments: regions,
          collection
        },
        inputVariable,
        collectionBinding: undefined
      });
    } else {
      changeDraft({
        ...next,
        callee: undefined,
        argumentRegions: undefined,
        arguments: undefined,
        expression: text,
        sourceCall: undefined,
        collectionBinding: undefined,
        inputVariable: undefined
      });
    }
  };
  const addSourceAlias = () => {
    if (!stepAvailable || !sourceEditable || !file || !editor || !owner) return;
    const binding = capture();
    if (!binding) return;
    const names = new Set(
      [...owner.inputs, ...owner.shortcuts, ...(owner.output ? [owner.output] : [])].map(({ name }) => name)
    );
    let index = 1;
    while (names.has('step' + index)) index++;
    const region = getFunctionAliasInsertion(owner, binding.source);
    changeDraft({
      binding,
      dependencies: editor.dependencySnapshot,
      name: 'step' + index,
      region,
      expression: '',
      adding: true,
      sourceOnly: !composition?.supported,
      stepId: composition?.supported ? DRAFT_NODE : undefined
    });
    setSelected(DRAFT_NODE);
  };
  const beginEdit = (step: CompositionStep) => {
    setSelected(step.id);
    selections.current.set(identity, step.id);
    setVariablesOpen(true);
    setTab('step');
    const next = makeDraft(step);
    if (next) changeDraft(next);
  };
  const [signaturePending, setSignaturePending] = useState(false);
  const stepAvailable = !draft && !signaturePending && !applyBusy && !inlineEditing;
  const canAdd = writable && stepAvailable;
  const outputStep = composition?.supported ? composition.steps.find((step) => step.kind === 'return') : undefined;
  const beginAdd = async (
    callee?: string,
    position?: XYPosition,
    primitiveId: CompositionPrimitiveId = 'expression'
  ) => {
    if (!canAdd || !composition || !editor) return;
    const binding = capture();
    if (!binding) return;
    setTab('step');
    setError(undefined);
    let n = 1;
    while (composition.steps.some((step) => step.name === `step${n}`)) n++;
    const name = `step${n}`;
    const suggestedName = portContext ? composition.steps.find((step) => step.id === portContext)?.name : undefined;
    const suggestedArgument = callee
      ? composition.callables?.find((candidate) => `${candidate.identity}#RosettaFunction` === callee)?.accepts[
          portContext ?? ''
        ]?.[0]
      : undefined;
    const primitive = findCompositionPrimitive(primitiveId)!;
    const collection = primitive.group === 'Collections' || primitive.group === 'Totals';
    const inputName = composition.steps.find((step) => {
      if (step.kind !== 'input') return false;
      const card = parseCardinality(step.parameter?.cardinality ?? '(1..1)');
      return !collection || card.unbounded || (card.sup ?? 1) > 1;
    })?.name;
    const input = inputName ? compositionReference(inputName) : undefined;
    let next: Draft = {
      binding,
      dependencies: editor.dependencySnapshot,
      region: { from: composition.insertion!, to: composition.insertion! },
      scopeRegion: composition.steps.find((step) => step.kind === 'return')?.region,
      name,
      position,
      adding: true,
      stepId: DRAFT_NODE,
      expressionType: primitive.expressionType,
      expression: primitive.expressionType
        ? createExpressionStarter(primitive.expressionType, input ?? (collection ? '[]' : '0'))
        : (input ?? '0')
    };
    if (callee) {
      if (!client) {
        setError('Function signatures are still loading. Try again.');
        return;
      }
      setSignaturePending(true);
      const owner = editor;
      try {
        const signature = await client.schema(callee, new AbortController().signal);
        if (
          current.current?.nodeId !== owner.nodeId ||
          current.current?.file?.content !== owner.file?.content ||
          current.current?.dependencySnapshot !== owner.dependencySnapshot
        )
          return;
        if (signature.kind !== 'function' || signature.status !== 'ready')
          throw new Error('This function signature is unavailable. Open its definition to inspect it.');
        next = {
          ...next,
          callee,
          arguments: signature.fields.map((field) => ({
            name: field.path,
            type:
              field.typeSymbol
                ?.split('#')[0]
                ?.split('.')
                .pop()
                ?.replace(/^builtin:/, '') ?? field.kind,
            cardinality: formatCardinality({
              inf: field.cardinality?.min ?? (field.required ? 1 : 0),
              sup: typeof field.cardinality?.max === 'number' ? field.cardinality.max : 1,
              unbounded: field.cardinality?.max === 'unbounded' || (!field.cardinality && field.kind === 'array')
            }),
            mode:
              (suggestedArgument === field.path && suggestedName) ||
              composition.steps.some((step) => step.name === field.path && step.kind !== 'return')
                ? ('variable' as const)
                : ('value' as const),
            variableId:
              suggestedArgument === field.path && suggestedName
                ? portContext
                : composition.steps.find((step) => step.name === field.path && step.kind !== 'return')?.id,
            value:
              suggestedArgument === field.path && suggestedName
                ? compositionReference(suggestedName)
                : composition.steps.some((step) => step.name === field.path && step.kind !== 'return')
                  ? compositionReference(field.path)
                  : (field.cardinality?.min ?? (field.required ? 1 : 0)) > 0
                    ? ''
                    : 'empty'
          }))
        };
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : 'Could not load the signature.');
        return;
      } finally {
        setSignaturePending(false);
      }
    }
    changeDraft(next);
    setSelected(next.stepId!);
    selections.current.set(identity, next.stepId!);
    setVariablesOpen(true);
    setFocusId(position ? undefined : DRAFT_NODE);
  };
  const sourceCall = draft?.sourceCall;
  const argumentRegions = sourceCall?.arguments ?? draft?.argumentRegions;
  const expression = draft?.callee
    ? argumentRegions
      ? compositionArgumentsText(
          sourceCall ? { source: sourceCall.text } : draft.binding,
          sourceCall ? { from: 0, to: sourceCall.text.length } : draft.region,
          [
            ...argumentRegions.map((region, index) => ({
              region,
              value: draft.arguments?.[index]?.value || EXPRESSION_DRAFT_HOLE
            })),
            ...(draft.collectionBinding ? [draft.collectionBinding] : [])
          ]
        )
      : compositionCallText(qualifiedNameFromNodeId(draft.callee), draft.arguments?.map(({ value }) => value) ?? [])
    : (draft?.expression ?? '');
  const expressionInvalid = useMemo(() => !expression.trim() || parseExpression(expression).hasErrors, [expression]);

  const stale = Boolean(
    draft &&
    (draft.binding.source !== file?.content ||
      draft.binding.nodeId !== identity ||
      draft.dependencies !== editor?.dependencySnapshot)
  );
  const wiring = useMemo<CompositionWiring | undefined>(
    () =>
      draft?.stepId
        ? {
            step: draft.stepId,
            inputs: [
              ...(draft.inputVariable ? [{ variable: draft.inputVariable, handle: 'input' }] : []),
              ...(draft.arguments?.map((argument, index) => ({
                variable: argument.variableId,
                handle: `argument:${index}`
              })) ?? [])
            ],
            output: draft.outputBinding?.variableId
          }
        : undefined,
    [draft]
  );
  const apply = async () => {
    if (
      !draft ||
      !(draft.sourceOnly ? sourceEditable : writable && composition) ||
      !editor ||
      stale ||
      applyBusy ||
      !file
    )
      return;
    setApplyBusy(true);
    setError(undefined);
    try {
      if (
        draft.arguments?.some(
          (argument) => !argument.value.trim() || (argument.mode === 'variable' && !argument.variableId)
        )
      )
        throw new Error('Bind each argument to a variable or enter a value. Use empty for an absent optional value.');
      const binding = draft.binding;
      const outputTarget = composition?.steps.find((step) => step.id === draft.outputBinding?.variableId);
      const edits = [];
      if (draft.adding && outputTarget?.region)
        edits.push(compositionExpressionEdit(binding, outputTarget.region, expression));
      else {
        if (!draft.bindingOnly)
          edits.push(
            draft.adding
              ? draft.sourceOnly
                ? buildAliasEdit(binding, draft.region, draft.name, expression)
                : compositionAliasEdit(binding, composition!, draft.name, expression)
              : compositionExpressionEdit(binding, draft.region, expression)
          );
        if (outputTarget && outputTarget.id !== draft.stepId) {
          if (!outputTarget.region || outputTarget.kind === 'input')
            throw new Error(
              'Function inputs are supplied by the caller; bind a local variable or the function output.'
            );
          if (compositionBindingCycle(composition!, outputTarget.id, draft.stepId!))
            throw new Error('This output binding would create a variable cycle.');
          edits.push(compositionExpressionEdit(binding, outputTarget.region, compositionReference(draft.name)));
        }
        if (draft.outputBinding?.name?.trim())
          edits.push(
            compositionAliasEdit(
              binding,
              composition!,
              draft.outputBinding.name.trim(),
              compositionReference(draft.name)
            )
          );
      }
      let candidate = compositionCandidate(binding, edits);
      let checked = composition;
      if (candidate !== binding.source && !draft.sourceOnly) {
        const dependencies = draft.dependencies ?? [file];
        const inspect = (source: string) =>
          requestFunctionComposition(file.path, binding.nodeId, dependencies, false, source);
        let facts = await inspect(candidate);
        const ordered = reorderCompositionVariables(candidate, facts);
        if (ordered !== candidate) {
          candidate = ordered;
          facts = await inspect(candidate);
        }
        if (!facts.supported)
          throw new Error(facts.reasons[0]?.message ?? 'This binding cannot be represented safely.');
        checked = facts;
      }
      if (current.current?.nodeId !== identity || current.current?.dependencySnapshot !== draft.dependencies)
        throw new Error('The workspace changed. Your draft is retained.');
      const view = runeView.current;
      if (!view) throw new Error('Waiting for Rune source to load.');
      const result = applyExpressionDocumentEdit(editor.documents, view, compositionSourceEdit(binding, candidate));
      if (!result.ok)
        throw new Error(
          result.reason === 'read-only'
            ? 'This source is read-only.'
            : 'The source changed. Your draft is retained. Reload this node before applying.'
        );
      const appliedId =
        checked?.supported && draft.stepId
          ? producerId(draft.adding ? (outputTarget?.id ?? `alias:${draft.name}`) : draft.stepId, checked.steps)
          : undefined;
      if (appliedId && draft.adding) {
        const position = flow.getNode(DRAFT_NODE)?.position;
        if (position && draft.position && !outputTarget) {
          const saved = positions.current.get(viewKey) ?? new Map<string, XYPosition>();
          saved.set(appliedId, position);
          positions.current.set(viewKey, saved);
        }
      }
      if (appliedId) {
        setSelected(appliedId);
        selections.current.set(identity, appliedId);
        setFocusId(appliedId);
      }
      changeDraft(undefined);
      setError(undefined);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not apply this binding.');
    } finally {
      setApplyBusy(false);
    }
  };
  const openInspector = () => usePerspectiveStore.getState().setActivePerspective('explore');
  const [saveBusy, setSaveBusy] = useState(false);
  const workspaceActions = useWorkspaceActionsOptional();
  const save = async () => {
    setSaveBusy(true);
    setError(undefined);
    try {
      await onSave();
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Save failed. Retry Save.');
      return false;
    } finally {
      setSaveBusy(false);
    }
  };
  const showPalette = () => {
    const panel = dock.current?.getPanel('compose.palette');
    if (panel?.api.location.type === 'edge') panel.group.api.expand();
    panel?.api.setActive();
    setQuery('');
  };
  const openFunction = (id: string, followStep = false) => {
    if (inlineEditing) {
      setError('Finish or cancel the current expression before opening another function.');
      return;
    }
    if (window.matchMedia?.(`(max-width: ${centerStackWidth - 1}px)`).matches)
      dock.current?.getEdgeGroup('left')?.collapse();
    if (id === identity) return;
    setBreadcrumbs((previous) => (followStep && identity ? [...previous, identity] : []));
    onNavigate(id);
  };
  const parent = breadcrumbs.at(-1);
  const pick = (step: CompositionStep, focus = true) => {
    if (draft && step.id !== selected) {
      setError('Apply or discard the current step draft before selecting another step.');
      return;
    }
    const id = composition ? producerId(step.id, composition.steps) : step.id;
    setSelected(id);
    selections.current.set(identity, id);
    setVariablesOpen(true);
    setTab('step');
    setError(undefined);
    setFocusId(focus ? id : undefined);
  };
  const stageArgument = (step: CompositionStep, index: number, value: string, variableId?: string) => {
    const variable = variables.find((entry) => entry.id === variableId);
    if (variable?.kind === 'output') {
      setError('The function output is assigned after its variables; it cannot supply an input.');
      return;
    }
    if (variable?.kind === 'local' && variable.producer !== step.id) {
      setError('This scoped value is only available inside its For each node.');
      return;
    }
    if (variableId && composition && compositionBindingCycle(composition, step.id, variableId)) {
      setError('This input binding would create a variable cycle.');
      return;
    }
    const next = makeDraft(step);
    if (!next?.arguments) return;
    setError(undefined);
    changeDraft({
      ...next,
      arguments: next.arguments.map((argument, i) =>
        i === index ? { ...argument, value, variableId, mode: variableId ? 'variable' : 'value' } : argument
      )
    });
    setSelected(step.id);
    setVariablesOpen(true);
  };
  const outputDraft = (step: CompositionStep) =>
    makeDraft(step) ??
    (step.kind === 'input' && !draft && writable && !applyBusy
      ? (() => {
          const binding = capture();
          return binding
            ? {
                binding,
                dependencies: editor?.dependencySnapshot,
                region: { from: 0, to: 0 },
                name: step.name,
                stepId: step.id,
                expression: step.name,
                bindingOnly: true
              }
            : undefined;
        })()
      : undefined);
  const actions: NodeBindingActions = {
    owner: identity,
    writable: writable && !stale && !inlineEditing,
    busy: applyBusy,
    selectedVariable,
    draftId: draft?.stepId,
    adding: Boolean(draft?.adding),
    variableName: draft?.outputBinding?.variableId
      ? (variables.find((variable) => variable.id === draft.outputBinding?.variableId)?.name ?? draft.name)
      : (draft?.name ?? ''),
    outputName: draft?.outputBinding?.name,
    outputTarget: draft?.outputBinding?.variableId,
    variables,
    arguments: (step) => {
      if (draft?.stepId === step.id) return draft.arguments ?? [];
      return (
        step.call?.inputs.map((input, index) => {
          const variableId = step.call!.argumentVariables?.[index];
          return {
            name: input.name,
            type: input.type,
            cardinality: input.cardinality,
            mode: variableId ? 'variable' : 'value',
            variableId,
            value: step.call!.arguments[index]
              ? presentedSource.slice(step.call!.arguments[index]!.from, step.call!.arguments[index]!.to)
              : ''
          };
        }) ?? []
      );
    },
    expression: (step) =>
      draft?.stepId === step.id
        ? expression
        : step.region
          ? presentedSource.slice(step.region.from, step.region.to)
          : '',
    select: pick,
    editExpression: (step, argument) => {
      const next = makeDraft(step);
      if (!next || (argument !== undefined && !next.arguments?.[argument])) return;
      changeDraft(next);
      setSelected(step.id);
      setError(undefined);
      setSource(true);
      setSourceFocus({ from: next.region.from, argument });
    },
    argument: stageArgument,
    argumentMode: (step, index, mode) => {
      const next = makeDraft(step);
      if (next?.arguments)
        changeDraft({
          ...next,
          arguments: next.arguments.map((argument, i) =>
            i === index
              ? { ...argument, mode, variableId: mode === 'value' ? undefined : argument.variableId }
              : argument
          )
        });
    },
    value: (step, value, variableId) => {
      if (variableId && step.call && step.call.inputs.length > 0 && !step.collection) {
        if (step.call.inputs.length === 1) stageArgument(step, 0, value, variableId);
        else setError('Connect to a named argument on this function call.');
        return;
      }
      const variable = variables.find((entry) => entry.id === variableId);
      if (variable?.kind === 'output') {
        setError('The function output is assigned after its variables; it cannot supply an input.');
        return;
      }
      if (variable?.kind === 'local' && variable.producer !== step.id) {
        setError('This scoped value is only available inside its For each node.');
        return;
      }
      if (variableId && composition && compositionBindingCycle(composition, step.id, variableId)) {
        setError('This input binding would create a variable cycle.');
        return;
      }
      const next = makeDraft(step);
      if (!next) return;
      try {
        const collection = next.sourceCall ? next.sourceCall.collection : step.collection;
        if (variableId && collection && next.arguments) {
          changeDraft({
            ...next,
            inputVariable: variableId,
            collectionBinding: { region: collection, value }
          });
        } else {
          changeDraft({
            ...next,
            expression: variableId ? compositionInputText(actions.expression(step), value) : value,
            sourceCall: undefined,
            inputVariable: variableId,
            callee: undefined,
            argumentRegions: undefined,
            arguments: undefined,
            collectionBinding: undefined
          });
        }
        setError(undefined);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : 'Could not bind this input.');
      }
      setVariablesOpen(true);
    },
    output: (step, variableId) => {
      if (!variableId) {
        const next = outputDraft(step);
        if (next) changeDraft({ ...next, outputBinding: undefined });
        return;
      }
      const variable = variables.find((variable) => variable.id === variableId);
      if (!variable || variable.kind === 'input' || variable.kind === 'local') {
        setError(
          'Function inputs and scoped values cannot be redefined. Choose a local variable or the function output.'
        );
        return;
      }
      if (composition && variableId !== step.id && compositionBindingCycle(composition, variableId, step.id)) {
        setError('This output binding would create a variable cycle.');
        return;
      }
      const next = outputDraft(step);
      if (next) changeDraft({ ...next, outputBinding: { variableId } });
      setVariablesOpen(true);
    },
    name: (name) => {
      if (draft) changeDraft({ ...draft, name, outputBinding: undefined });
    },
    newOutput: (step, name) => {
      const next = outputDraft(step);
      if (next) changeDraft({ ...next, outputBinding: name ? { name } : undefined });
    },
    apply: () => {
      void apply();
    },
    discard: () => {
      changeDraft(undefined);
      setError(undefined);
    }
  };
  const connectNodes = (connection: Connection) => {
    if (!actions.writable || actions.busy || !composition) return;
    const source =
      variables.find((variable) => variable.id === connection.source && variable.kind !== 'output') ??
      variables.find(
        (variable) => variable.producer === connection.source && variable.kind !== 'local' && variable.kind !== 'output'
      );
    const target =
      preview?.step.id === connection.target
        ? preview.step
        : composition.steps.find((step) => step.id === connection.target);
    const editingProducer = preview?.step ?? composition.steps.find((step) => step.id === draft?.stepId);
    if (
      editingProducer?.id === connection.source &&
      draft &&
      target?.kind === 'return' &&
      connection.targetHandle === 'input'
    ) {
      actions.output(editingProducer, target.id);
      return;
    }
    if (connection.source === DRAFT_NODE) {
      setError('Apply this new variable before connecting it to another step.');
      return;
    }
    if (!source || !target || target.kind === 'input') return;
    const argument = connection.targetHandle?.startsWith('argument:')
      ? Number(connection.targetHandle.slice('argument:'.length))
      : undefined;
    if (argument !== undefined && Number.isInteger(argument) && actions.arguments(target)[argument])
      actions.argument(target, argument, source.reference, source.id);
    else actions.value(target, source.reference, source.id);
  };
  const sourceOnly = Boolean(presented && !presented.supported);
  const canvasVisible = !editor || (canvasOpen && !sourceOnly);
  const sourceVisible = Boolean(editor && (source || sourceOnly));
  const sourceBinding = useMemo(
    () =>
      owner && editor && file
        ? editor.documents.capture(pathToUri(file.path), identity, getFunctionImplementationRegion(owner, file.content))
        : undefined,
    [owner, editor?.documents, file, identity]
  );
  useEffect(() => {
    if (!sourceVisible) setActiveSlot(undefined);
  }, [sourceVisible]);
  const sourceRequest = useComposeNavigationStore((state) => state.source);
  useEffect(() => {
    if (!active || sourceRequest?.workspaceKey !== workspaceKey || sourceRequest.nodeId !== identity) return;
    setViewPreferences((all) => ({ ...all, [identity]: { source: true, canvas: false } }));
    setSourceFocus(sourceRequest.target && { from: sourceRequest.target.root.from });
    useComposeNavigationStore.getState().clearSource(sourceRequest);
  }, [active, sourceRequest, workspaceKey, identity]);
  useEffect(() => {
    if (!sourceVisible || sourceFocus === undefined) return;
    const row = sourceHost.querySelector<HTMLElement>('[data-expression-from="' + sourceFocus.from + '"]');
    const argument = sourceFocus.argument;
    const trigger = row?.querySelector<HTMLButtonElement>(
      argument === undefined ? '[data-expression-token]' : '[data-expression-argument="' + argument + '"]'
    );
    if (!row || !trigger) return;
    row.scrollIntoView({ block: 'nearest' });
    trigger.focus({ preventScroll: true });
    if (argument !== undefined) trigger.click();
    setSourceFocus(undefined);
  }, [sourceVisible, sourceHost, sourceFocus, sourceEditable, rows]);
  const hasUndo = !draft && !inlineEditing && runeView.current && undoDepth(runeView.current.state) > 0;
  const undoSource = () => {
    if (
      runeView.current &&
      !draft &&
      !inlineEditing &&
      !applyBusy &&
      runeView.current.state.doc.toString() === file?.content
    ) {
      undo(runeView.current);
    }
  };
  const selectedScope = linkedScope?.owner === identity ? linkedScope.value : undefined;
  const variableTray = (
    <div className="composition-variables nodrag" role="region" aria-label="Available variables">
      <div className="composition-variables__header">
        <strong className="section-heading">Variables</strong>
        <Input
          aria-label="Filter variables"
          placeholder="Filter variables"
          value={variableQuery}
          onChange={(event) => setVariableQuery(event.target.value)}
        />
        <Button size="xs" variant="ghost" onClick={() => setVariablesOpen(false)}>
          Hide
        </Button>
      </div>
      <p className="text-caption">Drag a variable to a node input or output. Or select a tag and use Bind selected.</p>
      <div className="composition-variables__tags">
        {variables
          .filter((variable) => variable.name.toLowerCase().includes(variableQuery.toLowerCase()))
          .map((variable) => (
            <button
              key={variable.id}
              type="button"
              className="composition-variable-tag"
              aria-pressed={selectedVariable === variable.id}
              draggable={writable}
              title={`${variable.kind} ${variable.type ?? ''} ${variable.cardinality ?? ''}`}
              onClick={() => {
                if (sourceVisible && activeSlot && variable.kind !== 'output')
                  activeSlot.openPicker(variable.reference);
                else setSelectedVariable(variable.id);
              }}
              onDragStart={(event) => {
                event.dataTransfer.setData(VARIABLE_MIME, JSON.stringify({ owner: identity, variable: variable.id }));
                event.dataTransfer.effectAllowed = 'link';
              }}
            >
              <span>{variable.name}</span>
              <small>{variable.kind === 'variable' ? variable.type : variable.kind}</small>
            </button>
          ))}
      </div>
    </div>
  );
  const expressionRows = sourceBinding && editor && file && (
    <InlineExpressionRows
      session={{
        binding: sourceBinding,
        documents: editor.documents,
        file,
        files: editor.dependencySnapshot ?? [file],
        scope: selectedScope
      }}
      rows={rows}
      draft={
        draft && !draft.bindingOnly
          ? {
              region: draft.region,
              text: expression,
              argumentNames: draft.arguments?.map(({ name }) => name),
              alias: draft.adding
                ? { name: draft.name, onRename: (name) => changeDraft({ ...draft, name }) }
                : undefined
            }
          : undefined
      }
      pending={applyBusy}
      editable={sourceEditable && !stale}
      invalid={expressionInvalid}
      onChange={changeSource}
      onAdd={addSourceAlias}
      onApply={() => void apply()}
      onDiscard={() => {
        changeDraft(undefined);
        setError(undefined);
      }}
      onActiveSlot={setActiveSlot}
      onEditingChange={setInlineEditing}
      onHighlightRange={(range) => runeView.current?.dispatch({ effects: setExpressionHighlight.of(range) })}
      highlightedRange={codeHover}
      after={!canvasVisible && presented?.supported && (activeSlot || variablesOpen) ? variableTray : undefined}
    />
  );
  const sourceView = editor ? (
    <div className="function-composer__source studio-scroll">
      {presented && sourceOnly && (
        <div className="function-composer__notice">
          <h2>Source-only function</h2>
          {presented.reasons.map((reason, index) => (
            <p key={index} className="text-caption">
              Line {presentedSource.slice(0, reason.region.from).split('\n').length}: {reason.message}
            </p>
          ))}
        </div>
      )}
      <ExpressionWorkspace
        key={identity}
        {...editor}
        inlineRune={
          expressionRows || (
            <p role="status" className="text-caption">
              Waiting for the current Rune source…
            </p>
          )
        }
        onRuneView={(view) => {
          runeView.current = view;
        }}
        onRuneHover={(offset) => setCodeHover(offset === undefined ? undefined : { from: offset, to: offset })}
      />
    </div>
  ) : null;

  return (
    <NodeBindingContext.Provider value={actions}>
      <section
        className="function-composer"
        aria-label="Function composer"
        data-testid="function-composer"
        onKeyDown={(event) => {
          if (
            !(event.metaKey || event.ctrlKey) ||
            event.shiftKey ||
            event.key.toLowerCase() !== 'z' ||
            !(event.target instanceof HTMLElement) ||
            event.target.closest('input, textarea, [contenteditable]')
          )
            return;
          if (hasUndo) {
            event.preventDefault();
            undoSource();
          }
        }}
      >
        <header
          className="studio-layout-presets studio-layout-presets--compose"
          data-testid={active ? 'perspective-header-row' : undefined}
        >
          <PerspectiveHeading
            perspectiveId="compose"
            location={!creating && identity ? qualifiedNameFromNodeId(identity) : undefined}
          />
          <div className="studio-layout-presets__group studio-layout-presets__group--actions flex-wrap justify-end">
            {parent && (
              <Button
                size="xs"
                variant="ghost"
                disabled={inlineEditing}
                onClick={() => {
                  setBreadcrumbs((previous) => previous.slice(0, -1));
                  onNavigate(parent);
                }}
              >
                <ArrowLeft className="size-3" />
                Parent
              </Button>
            )}
            <SourceSaveControl
              state={workspaceActions?.workspaceSaveState}
              enabled={workspaceActions?.workspaceAutosaveEnabled}
              onEnabledChange={workspaceActions?.setWorkspaceAutosave}
              save={onSave}
              saveLabel="Save"
              busy={saveBusy}
            />
            {hasUndo && (
              <Button size="xs" variant="ghost" onClick={undoSource}>
                Undo expression edit
              </Button>
            )}
            {stale && (
              <Button
                size="xs"
                variant="ghost"
                disabled={applyBusy}
                onClick={() => {
                  changeDraft(undefined);
                  setError(undefined);
                }}
              >
                Discard stale draft
              </Button>
            )}
            {recipe && (
              <Button
                size="xs"
                disabled={Boolean(createdId) || saveBusy || !composition?.supported || Boolean(draft)}
                variant="ghost"
                onClick={async () => {
                  if (await save()) {
                    useComposeNavigationStore.getState().requestRecipe(project.workspaceId!, recipe);
                    usePerspectiveStore.getState().setActivePerspective('prototype');
                  }
                }}
              >
                Try in Prototype
              </Button>
            )}
            <Button size="xs" variant="ghost" onClick={openInspector}>
              Inspector
              <ArrowUpRight className="size-3" />
            </Button>
            <Button size="xs" onClick={() => setCreating(true)}>
              <Plus className="size-3" />
              New composition
            </Button>
          </div>
        </header>
        {error && (
          <div className="function-composer__error" role="alert">
            {error}
            <Button size="xs" variant="ghost" onClick={() => setRetry(retry + 1)}>
              Retry
            </Button>
          </div>
        )}
        {creating ? (
          <WorkflowFunctionBuilder
            embedded
            onClose={() => setCreating(false)}
            onCreated={(workflow) => {
              setCreating(false);
              if (workflow.function) {
                const id = makeNodeId(workflow.function.namespace, workflow.function.name, 'RosettaFunction');
                setViewPreferences((all) => ({ ...all, [id]: { source: false, canvas: true } }));
                setCreatedId(id);
              }
            }}
          />
        ) : (
          <ComposeWorkbench
            workspaceKey={workspaceKey}
            layoutKey={project.workspaceId ?? workspaceKey}
            active={active}
            onReady={(api) => {
              dock.current = api;
            }}
            palette={
              <aside className="function-composer__side" aria-label="Composition palette">
                <div className="function-composer__panel-body studio-scroll">
                  <SearchInput
                    ref={paletteSearch}
                    aria-label="Search functions and primitives"
                    placeholder="Search the palette"
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      if (event.target.value.trim()) setDiscover(true);
                    }}
                  />
                  {portContext && (
                    <p>
                      Suggested for {composition?.steps.find((step) => step.id === portContext)?.name}.{' '}
                      <Button size="xs" variant="ghost" onClick={() => setPortContext(undefined)}>
                        Clear context
                      </Button>
                    </p>
                  )}
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={loading || !composition?.supported || Boolean(composition.callables)}
                    onClick={() => {
                      setDiscover(true);
                      setRetry(retry + 1);
                    }}
                  >
                    {discover && loading
                      ? 'Loading signatures…'
                      : composition?.callables
                        ? 'Signatures loaded'
                        : 'Show signatures'}
                  </Button>
                  <FunctionPalette
                    repository={repository}
                    compositionIds={compositionIds}
                    query={query}
                    callables={composition?.callables}
                    portContext={portContext}
                    selectedNodeId={identity}
                    canAdd={canAdd || Boolean(activeSlot)}
                    onOpen={openFunction}
                    onAdd={(id) => {
                      if (activeSlot && sourceVisible) {
                        const name = qualifiedNameFromNodeId(id);
                        const callable = selectedScope?.references?.find(
                          (entry) => entry.kind === 'callable' && entry.name === name
                        );
                        if (callable?.argumentCount !== undefined) {
                          activeSlot.replace(compositionCallText(name, Array<string>(callable.argumentCount).fill('')));
                        } else {
                          setError('This function’s linked signature is unavailable at the current expression.');
                        }
                      } else void beginAdd(id);
                    }}
                  />
                  <h2 className="section-heading">Primitives</h2>
                  <div className="function-composer__primitives">
                    {primitiveGroups.map((group) => (
                      <div key={group} role="group" aria-label={group}>
                        <h3 className="section-heading">{group}</h3>
                        <div className="function-composer__primitive-grid">
                          {matchingPrimitives
                            .filter((primitive) => primitive.group === group)
                            .map(({ id, label, description, icon: Icon }) => {
                              const disabled =
                                id === 'output' ? !outputStep : !canAdd && !(activeSlot && sourceVisible);
                              return (
                                <Button
                                  key={id}
                                  size="sm"
                                  variant="ghost"
                                  title={description}
                                  disabled={disabled}
                                  draggable={!disabled && stepAvailable}
                                  onDragStart={(event) => {
                                    event.dataTransfer.setData(PRIMITIVE_MIME, id);
                                    event.dataTransfer.effectAllowed = 'copy';
                                  }}
                                  onClick={() => {
                                    if (id !== 'output' && activeSlot && sourceVisible) {
                                      const type = findCompositionPrimitive(id)?.expressionType;
                                      if (type) activeSlot.replace(createExpressionStarter(type, '(<?>)'));
                                    } else if (id !== 'output') void beginAdd(undefined, undefined, id);
                                    else if (outputStep) pick(outputStep);
                                  }}
                                >
                                  <Icon aria-hidden="true" />
                                  {label}
                                </Button>
                              );
                            })}
                        </div>
                      </div>
                    ))}
                    {!matchingPrimitives.length && <p>No matching primitives.</p>}
                  </div>
                </div>
              </aside>
            }
            center={
              <section className="function-composer__center" aria-label="Composition editor">
                <WorkbenchViewBar
                  label="Composition view"
                  groups={[
                    {
                      label: 'View',
                      views: [
                        {
                          id: 'canvas',
                          label: 'Canvas',
                          icon: Network,
                          active: canvasVisible,
                          disabled: !editor || sourceOnly,
                          onToggle: () => {
                            if (!canvasOpen || sourceVisible) setCanvasOpen(!canvasOpen);
                          }
                        },
                        {
                          id: 'source',
                          label: 'Source',
                          icon: Code,
                          active: sourceVisible,
                          disabled: !editor || sourceOnly,
                          onToggle: () => {
                            if (!source || canvasVisible) setSource(!source);
                          }
                        }
                      ]
                    }
                  ]}
                >
                  {!composition && presented && (
                    <span className="function-composer__pending" role="status">
                      Updating…
                    </span>
                  )}
                </WorkbenchViewBar>
                <SplitWorkbench
                  stackAt={centerStackWidth}
                  panes={[
                    {
                      id: 'composition-canvas-view',
                      minSize: '20%',
                      visible: canvasVisible,
                      content: (
                        <section className="function-composer__canvas" aria-label="Composition canvas">
                          {sourceVisible && <WorkbenchPaneHeading label="Canvas" />}

                          {!editor ? (
                            <div className="function-composer__empty">
                              <Workflow />
                              <h2>Compose a Rune function</h2>
                              {compositionIds.size > 0 && (
                                <Button
                                  variant="secondary"
                                  onClick={() => {
                                    showPalette();
                                    requestAnimationFrame(() => paletteSearch.current?.focus());
                                  }}
                                >
                                  Browse compositions
                                </Button>
                              )}
                              <Button onClick={() => setCreating(true)}>New composition</Button>
                            </div>
                          ) : !presented ? (
                            <div className="function-composer__empty" role="status">
                              <p>
                                {loading
                                  ? 'Resolving composition…'
                                  : editor.readOnly
                                    ? 'Reference source is read-only. Open Source to inspect it, or use Modify in Inspector.'
                                    : 'Waiting for the current source to parse. Open Source to inspect or correct it.'}
                              </p>
                              <Button variant="ghost" onClick={() => setSource(true)}>
                                Open Source
                              </Button>
                            </div>
                          ) : (
                            <CompositionCanvas
                              key={viewKey}
                              current={composition && presented}
                              presented={presented}
                              source={presentedSource}
                              preview={preview}
                              wiring={wiring}
                              active={active}
                              vertical={vertical}
                              selected={selected}
                              variablesOpen={variablesOpen}
                              viewKey={viewKey}
                              size={canvasSize}
                              onGraphElement={setCanvasElement}
                              focus={focusId}
                              setFocus={setFocusId}
                              positions={positions.current}
                              viewports={viewports.current}
                              onSelect={pick}
                              onDraftMove={(position) => {
                                if (draft?.adding) changeDraft({ ...draft, position });
                              }}
                              onConnect={connectNodes}
                              onDrop={(event, placeNode) => {
                                const primitive = findCompositionPrimitive(event.dataTransfer.getData(PRIMITIVE_MIME));
                                const id = event.dataTransfer.getData(MIME);
                                if (!primitive && repository.byId(id)?.data.$type !== 'RosettaFunction') return;
                                event.preventDefault();
                                const position = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
                                if (primitive?.id === 'output') {
                                  if (!outputStep || !stepAvailable) return;
                                  placeNode(outputStep.id, position);
                                  pick(outputStep, false);
                                } else if (primitive) {
                                  void beginAdd(undefined, position, primitive.id);
                                } else {
                                  void beginAdd(id, position);
                                }
                              }}
                            />
                          )}
                          {variablesOpen && presented?.supported && variableTray}
                        </section>
                      )
                    },
                    {
                      id: 'composition-source-view',
                      minSize: '20%',
                      visible: sourceVisible,
                      separatorLabel: 'Resize composition views',
                      content: (
                        <section className="function-composer__source-pane" aria-label="Composition source">
                          {canvasVisible && <WorkbenchPaneHeading label="Source" />}
                          <div className="min-h-0 flex-1 overflow-auto" ref={attachSource} />
                        </section>
                      )
                    }
                  ]}
                />
              </section>
            }
            details={
              <aside className="function-composer__side" aria-label="Composition details">
                <Tabs
                  className="flex min-h-0 flex-1 flex-col"
                  value={tab}
                  onValueChange={(value: 'step' | 'signature') => setTab(value)}
                >
                  <TabsList size="sm" aria-label="Composition details" className="shrink-0 px-2">
                    <TabsTrigger value="step">Step</TabsTrigger>
                    <TabsTrigger value="signature">Signature & details</TabsTrigger>
                  </TabsList>
                  <TabsContent value="signature" className="function-composer__panel-body studio-scroll">
                    {inspector}
                  </TabsContent>
                  <TabsContent value="step" className="function-composer__panel-body studio-scroll">
                    {!editor ? (
                      <p>Select a function to inspect its steps.</p>
                    ) : !presented?.supported ? (
                      <p className="text-caption">Use Source or Signature & details for this function.</p>
                    ) : (
                      <>
                        <label className="function-composer__step-picker">
                          Step
                          <NativeSelect
                            aria-label="Selected composition step"
                            value={selected}
                            onChange={(event) => {
                              const step = presented?.steps.find((step) => step.id === event.target.value);
                              if (step) pick(step);
                            }}
                          >
                            {presented?.steps
                              .filter((step) => !step.variableSource || step.kind === 'return')
                              .map((step) => (
                                <option key={step.id} value={step.id}>
                                  {step.kind === 'input' ? 'Input: ' : step.kind === 'return' ? 'Output: ' : ''}
                                  {step.name}
                                </option>
                              ))}
                          </NativeSelect>
                        </label>
                        {selectedStep?.parameter && selectedStep.kind !== 'return' && (
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => {
                              setPortContext(selectedStep.id);
                              setDiscover(true);
                              showPalette();
                            }}
                          >
                            Find calls for {selectedStep.name}
                          </Button>
                        )}
                        {selectedStep && !draft && (
                          <>
                            <h2>{selectedStep.name}</h2>
                            {selectedStep.parameter && (
                              <p>
                                {selectedStep.parameter.type} · {selectedStep.parameter.cardinality}
                              </p>
                            )}
                            {selectedStep.region && !selectedStep.call && (
                              <Button
                                size="xs"
                                variant="outline"
                                disabled={!writable}
                                onClick={() => beginEdit(selectedStep)}
                              >
                                Edit expression
                              </Button>
                            )}
                          </>
                        )}
                        {selectedStep?.call && (
                          <Button
                            size="xs"
                            variant="ghost"
                            aria-label={`Open ${selectedStep.call.identity.split('.').pop()} definition`}
                            onClick={() => openFunction(`${selectedStep.call!.identity}#RosettaFunction`, true)}
                          >
                            Open {selectedStep.call.identity.split('.').pop()}
                            <ArrowUpRight className="size-3" />
                          </Button>
                        )}
                        {file?.readOnly || file?.refOnly ? (
                          <p>
                            Reference source is read-only. Use Modify in the inspector to create an editable override.
                          </p>
                        ) : null}
                        {draft && (
                          <div className="function-composer__draft">
                            <h2>{draft.adding ? 'New variable' : draft.name}</h2>
                            <p>
                              Bind arguments and output variables directly on the node. Use the expression editor for a
                              complex value.
                            </p>
                            {draft.region && !draft.bindingOnly && (
                              <Button
                                size="xs"
                                variant="ghost"
                                onClick={() => {
                                  setSource(true);
                                  setSourceFocus({ from: draft.region.from });
                                }}
                              >
                                Edit in Source
                              </Button>
                            )}
                            {stale && (
                              <p role="status">
                                Source changed. Your draft is retained. Discard it to reload the current expression.
                              </p>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </TabsContent>
                </Tabs>
              </aside>
            }
          />
        )}
        {sourceView && createPortal(sourceView, sourceHost)}
      </section>
    </NodeBindingContext.Provider>
  );
}
