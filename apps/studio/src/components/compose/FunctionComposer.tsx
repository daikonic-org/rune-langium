// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Daikonic contributors
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  applyNodeChanges,
  useReactFlow,
  useNodesInitialized,
  type Edge,
  type XYPosition
} from '@xyflow/react';
import { type CompositionStep, type FunctionComposition, type SourceRegion } from '@rune-langium/core';
import {
  buildTypeOptions,
  computeGraphPositions,
  selectNodeRepository,
  useEditorStore,
  ExpressionBuilder,
  makeNodeId,
  qualifiedNameFromNodeId,
  formatCardinality
} from '@rune-langium/visual-editor';
import { Button } from '@rune-langium/design-system/ui/button';
import { Input } from '@rune-langium/design-system/ui/input';
import {
  ArrowLeft,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Workflow,
  Code,
  Network,
  ArrowUpRight
} from 'lucide-react';
import { requestFunctionComposition } from '../../services/workspace.js';
import {
  compositionReference,
  compositionAliasEdit,
  compositionExpressionEdit,
  compositionArgumentsText,
  compositionCandidate,
  compositionSourceEdit,
  reorderCompositionVariables,
  compositionBindingCycle
} from '../../services/composition-edit.js';
import type { DocumentBinding } from '../../services/expression-document.js';
import { usePerspectiveStore } from '../../store/perspective-store.js';
import { useComposeNavigationStore } from '../../store/compose-navigation-store.js';
import { usePreviewSession } from '../../shell/providers/preview-session-context.js';
import { ExpressionWorkspace, type ExpressionWorkspaceProps } from '../editing/ExpressionWorkspace.js';
import { SourceEditor } from '../SourceEditor.js';
import { WorkflowFunctionBuilder } from '../WorkflowFunctionBuilder.js';
import { readWorkflows } from '@rune-langium/project-config';
import { useProject } from '../../shell/providers/project-context.js';
import { pathToUri } from '../../utils/uri.js';
import { withInstrumentation } from '../../services/instrumentation/core.js';
import './function-composer.css';

import {
  CompositionNode,
  NodeBindingContext,
  VARIABLE_MIME,
  type ComposerNode,
  type CompositionVariable,
  type NodeArgument,
  type NodeBindingActions
} from './CompositionNode.js';
const MIME = 'application/x-rune-composition-function';
const FIT = { padding: 0.12, minZoom: 0.35, maxZoom: 1 };
const NODE_TYPES = { composition: CompositionNode };
const DRAFT_NODE = 'draft:new';

/** Reference-only aliases project as tags on their existing producer. */
function producerId(id: string, steps: readonly CompositionStep[]): string {
  const visited = new Set<string>();
  let current = id;
  while (!visited.has(current)) {
    visited.add(current);
    const step = steps.find((step) => step.id === current);
    const source = step?.kind === 'return' ? undefined : step?.variableSource;
    if (!source) break;
    current = source;
  }
  return current;
}
function compositionEdges(composition: FunctionComposition): Edge[] {
  return composition.steps
    .filter((step) => !step.variableSource || step.kind === 'return')
    .flatMap((step) =>
      [...new Set(step.dependencies.map((id) => producerId(id, composition.steps)))].map((dependency) => ({
        id: `${dependency}->${step.id}`,
        source: dependency,
        target: step.id
      }))
    );
}
function layoutNodes(
  nodes: ComposerNode[],
  edges: Edge[],
  vertical: boolean,
  pinned?: Map<string, XYPosition>
): ComposerNode[] {
  const positions = computeGraphPositions(
    nodes.map((node) => ({
      id: node.id,
      width: node.measured?.width ?? 280,
      height: node.measured?.height ?? (node.data.step.kind === 'input' ? 140 : 240)
    })),
    edges,
    { direction: vertical ? 'TB' : 'LR', nodeSeparation: 40, rankSeparation: 60 }
  );
  return nodes.map((node) => ({ ...node, position: pinned?.get(node.id) ?? positions[node.id] ?? node.position }));
}

export interface FunctionComposerProps {
  workspaceKey: string;
  editor?: ExpressionWorkspaceProps;
  inspector: ReactNode;
  active: boolean;
  onNavigate(nodeId: string): void;
  onSave(): Promise<void>;
  saveLabel: string;
}
interface Draft {
  binding: DocumentBinding;
  dependencies?: ExpressionWorkspaceProps['dependencySnapshot'];
  region: SourceRegion;
  scopeRegion?: SourceRegion;
  expression: string;
  name: string;
  stepId?: string;
  adding?: boolean;
  callee?: string;
  argumentRegions?: SourceRegion[];
  arguments?: NodeArgument[];
  outputBinding?: { variableId?: string; name?: string };
  position?: XYPosition;
  bindingOnly?: boolean;
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
function Composer({ editor, inspector, active, onNavigate, onSave, saveLabel }: FunctionComposerProps) {
  const creating = useComposeNavigationStore((s) => s.creating);
  const setCreating = useComposeNavigationStore((s) => s.setCreating);
  const nodesById = useEditorStore((s) => s.nodesById);
  const catalog = useMemo(
    () => buildTypeOptions(selectNodeRepository(nodesById)).filter((option) => option.kind === 'func'),
    [nodesById]
  );
  const [portContext, setPortContext] = useState<string>();
  const [discover, setDiscover] = useState(false);
  const [variablesOpen, setVariablesOpen] = useState(false);
  const [variableQuery, setVariableQuery] = useState('');
  const [selectedVariable, setSelectedVariable] = useState<string>();
  const [applyBusy, setApplyBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [palette, setPalette] = useState(() => !(window.matchMedia?.('(max-width: 899px)').matches ?? false));
  const [details, setDetails] = useState(true);
  const [tab, setTab] = useState<'step' | 'signature'>('step');
  const [source, setSource] = useState(false);
  const [selected, setSelected] = useState('return');
  const [focusId, setFocusId] = useState<string>();
  const [facts, setFacts] = useState<{ source: string; nodeId: string; value: FunctionComposition }>();
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
  const [nodes, setNodes] = useState<ComposerNode[]>([]);
  const [draft, setDraft] = useState<Draft>();
  const drafts = useRef(new Map<string, Draft>());
  const viewports = useRef(new Map<string, { x: number; y: number; zoom: number }>());
  const cameraKey = useRef<string | undefined>(undefined);
  const positions = useRef(new Map<string, Map<string, XYPosition>>());
  const breadcrumbs = useRef<string[]>([]);
  const selections = useRef(new Map<string, string>());
  const client = usePreviewSession();
  const project = useProject();
  const flow = useReactFlow<ComposerNode>();
  const nodesInitialized = useNodesInitialized();
  const current = useRef(editor);
  current.current = editor;
  const identity = editor?.nodeId ?? '';
  const recipe = project.snapshot
    ? readWorkflows(project.snapshot).workflows.find(
        (entry) => entry.function && `${entry.function.namespace}.${entry.function.name}#RosettaFunction` === identity
      )
    : undefined;
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
          setFacts({ source: captured.file!.content, nodeId: identity, value });
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
    facts?.nodeId === identity && facts.source === file?.content && editor?.parseCurrent ? facts.value : undefined;
  // Keep the last graph mounted during a reparse. Only current facts permit editing.
  const presented = composition ?? (facts?.nodeId === identity ? facts.value : undefined);
  const presentedSource = facts?.nodeId === identity ? facts.source : (file?.content ?? '');
  const writable = Boolean(composition?.supported && file && !file.readOnly && !file.refOnly && !editor?.readOnly);
  useEffect(() => {
    if (!composition || draft?.adding) return;
    const id = producerId(selected, composition.steps);
    if (id !== selected) {
      setSelected(id);
      selections.current.set(identity, id);
    }
  }, [composition, selected, draft?.adding, identity]);
  useEffect(() => {
    if (!composition || !file) return;
    const saved = positions.current.get(viewKey);
    setNodes(
      layoutNodes(
        composition.steps
          .filter((step) => !step.variableSource || step.kind === 'return')
          .map((step) => ({
            id: step.id,
            type: 'composition',
            position: { x: 0, y: 0 },
            selected: step.id === selected,
            data: {
              step,
              vertical,
              expression: step.region ? file.content.slice(step.region.from, step.region.to) : ''
            }
          })),
        compositionEdges(composition),
        vertical,
        saved
      )
    );
  }, [composition, file?.content, viewKey, vertical]);
  useEffect(() => {
    setNodes((previous) => previous.map((node) => ({ ...node, selected: node.id === selected })));
  }, [selected, composition]);
  const edges = presented ? compositionEdges(presented) : [];
  const previewStep: CompositionStep | undefined = draft?.adding
    ? {
        id: draft.stepId!,
        name: draft.name,
        kind: draft.callee ? 'call' : 'expression',
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
      }
    : undefined;
  const selectedStep = previewStep ?? presented?.steps.find((step) => step.id === selected);
  const withPreview = (previous: ComposerNode[]): ComposerNode[] => {
    const original = previous.find((node) => node.id === DRAFT_NODE);
    const visible = previous.filter((node) => node.id !== DRAFT_NODE);
    return previewStep
      ? [
          ...visible,
          {
            ...original,
            id: DRAFT_NODE,
            type: 'composition',
            selected: true,
            position: draft?.position ?? original?.position ?? { x: 320, y: 180 },
            data: { step: previewStep, expression: draft?.expression ?? '', vertical }
          }
        ]
      : visible;
  };
  const graphNodes = withPreview(nodes);
  useEffect(() => {
    if (source) {
      cameraKey.current = undefined;
      return;
    }
    if (
      !active ||
      !composition ||
      !nodesInitialized ||
      !nodes.length ||
      cameraKey.current === viewKey ||
      nodes.some(
        (node) => node.id !== DRAFT_NODE && node.data.step !== composition.steps.find((step) => step.id === node.id)
      )
    )
      return;
    cameraKey.current = viewKey;
    if (!focusId) {
      const saved = viewports.current.get(viewKey);
      if (saved) void flow.setViewport(saved);
      else setFocusId('*');
    }
  }, [active, source, composition, nodes, nodesInitialized, viewKey, flow, focusId]);

  useEffect(() => {
    // A different canvas size/direction needs a fresh camera, not old pixel offsets.
    if (canvasSize.width > 0) setFocusId(variablesOpen ? selected : '*');
  }, [canvasSize.width, canvasSize.height, vertical]);
  useEffect(() => {
    if (
      !active ||
      source ||
      !focusId ||
      !nodesInitialized ||
      !nodes.length ||
      nodes.some((node) => !node.measured?.height) ||
      (focusId !== '*' && !nodes.some((node) => node.id === focusId))
    )
      return;
    const frame = requestAnimationFrame(() => {
      void flow
        .fitView(focusId === '*' ? FIT : { nodes: [{ id: focusId }], padding: 0.15, minZoom: 0.35, maxZoom: 1 })
        .then((fitted) => {
          if (fitted) setFocusId((current) => (current === focusId ? undefined : current));
        });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusId, nodes, nodesInitialized, active, source, flow, canvasSize.width, canvasSize.height]);
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
    if (!step.region || !writable) return;
    const binding = capture();
    if (!binding) return;
    return {
      binding,
      dependencies: editor?.dependencySnapshot,
      region: step.region,
      name: step.name,
      stepId: step.id,
      expression: binding.source.slice(step.region.from, step.region.to),
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
  const beginEdit = (step: CompositionStep) => {
    setSelected(step.id);
    selections.current.set(identity, step.id);
    setVariablesOpen(true);
    setTab('step');
    const next = makeDraft(step);
    if (next) changeDraft(next);
  };
  const [signaturePending, setSignaturePending] = useState(false);
  const beginAdd = async (callee?: string, position?: XYPosition, each = false) => {
    if (!writable || !composition || draft || !editor || signaturePending || applyBusy) return;
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
    const inputName = composition.steps.find(
      (step) => step.kind === 'input' && (!each || !/\.\.1\)?$/.test(step.parameter?.cardinality ?? ''))
    )?.name;
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
      expression: each
        ? `${input ?? variables.find((variable) => variable.kind === 'input')?.reference ?? '[]'} extract [ item ]`
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
    setFocusId(DRAFT_NODE);
  };
  const expression = draft?.callee
    ? draft.argumentRegions
      ? compositionArgumentsText(
          draft.binding,
          draft.region,
          draft.argumentRegions.map((region, index) => ({ region, value: draft.arguments?.[index]?.value ?? '' }))
        )
      : `${qualifiedNameFromNodeId(draft.callee)}(${draft.arguments?.map((argument) => argument.value).join(', ') ?? ''})`
    : (draft?.expression ?? '');

  const stale = Boolean(
    draft &&
    (draft.binding.source !== file?.content ||
      draft.binding.nodeId !== identity ||
      draft.dependencies !== editor?.dependencySnapshot)
  );
  const apply = async () => {
    if (!draft || !composition || !writable || !editor || stale || applyBusy || !file) return;
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
      const outputTarget = composition.steps.find((step) => step.id === draft.outputBinding?.variableId);
      const edits = [];
      if (draft.adding && outputTarget?.region)
        edits.push(compositionExpressionEdit(binding, outputTarget.region, expression));
      else {
        if (!draft.bindingOnly)
          edits.push(
            draft.adding
              ? compositionAliasEdit(binding, composition, draft.name, expression)
              : compositionExpressionEdit(binding, draft.region, expression)
          );
        if (outputTarget && outputTarget.id !== draft.stepId) {
          if (!outputTarget.region || outputTarget.kind === 'input')
            throw new Error(
              'Function inputs are supplied by the caller; bind a local variable or the function output.'
            );
          if (compositionBindingCycle(composition, outputTarget.id, draft.stepId!))
            throw new Error('This output binding would create a variable cycle.');
          edits.push(compositionExpressionEdit(binding, outputTarget.region, compositionReference(draft.name)));
        }
        if (draft.outputBinding?.name?.trim())
          edits.push(
            compositionAliasEdit(
              binding,
              composition,
              draft.outputBinding.name.trim(),
              compositionReference(draft.name)
            )
          );
      }
      let candidate = compositionCandidate(binding, edits);
      let checked = composition;
      if (candidate !== binding.source) {
        const dependencies = draft.dependencies ?? [file];
        const inspect = (source: string) =>
          requestFunctionComposition(file.path, binding.nodeId, dependencies, false, source);
        let facts = await inspect(candidate);
        if (!facts.optedIn) throw new Error('The composition marker or function identity changed. Reload this node.');
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
      const result = editor.documents.applyDocumentEdit(compositionSourceEdit(binding, candidate));
      if (!result.ok)
        throw new Error(
          result.reason === 'read-only'
            ? 'This source is read-only.'
            : 'The source changed. Your draft is retained. Reload this node before applying.'
        );
      const appliedId = producerId(
        draft.adding ? (outputTarget?.id ?? `alias:${draft.name}`) : draft.stepId!,
        checked.steps
      );
      if (draft.adding) {
        const position = flow.getNode(DRAFT_NODE)?.position;
        if (position && draft.position && !outputTarget) {
          const saved = positions.current.get(viewKey) ?? new Map<string, XYPosition>();
          saved.set(appliedId, position);
          positions.current.set(viewKey, saved);
        }
      }
      setSelected(appliedId);
      selections.current.set(identity, appliedId);
      setFocusId(appliedId);
      changeDraft(undefined);
      setError(undefined);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not apply this binding.');
    } finally {
      setApplyBusy(false);
    }
  };
  const callable = new Map(composition?.callables?.map((entry) => [`${entry.identity}#RosettaFunction`, entry]));
  const signatureLabel = (id: string) => {
    const entry = callable.get(id);
    return entry
      ? `${entry.inputs.map((input) => `${input.name}: ${input.type} ${input.cardinality}`).join(', ')} → ${entry.output ? `${entry.output.type} ${entry.output.cardinality}` : 'no output'}`
      : '';
  };
  const filtered = catalog
    .filter((option) =>
      `${option.label} ${option.namespace} ${signatureLabel(option.value)} ${callable.get(option.value)?.documentation ?? ''}`
        .toLowerCase()
        .includes(query.toLowerCase())
    )
    .sort(
      (a, b) =>
        Number(Boolean(callable.get(b.value)?.accepts[portContext ?? '']?.length)) -
        Number(Boolean(callable.get(a.value)?.accepts[portContext ?? '']?.length))
    );

  const openInspector = () => usePerspectiveStore.getState().setActivePerspective('explore');
  const [saveBusy, setSaveBusy] = useState(false);
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
  const navigate = (id: string) => {
    if (id === identity) return;
    if (identity) breadcrumbs.current.push(identity);
    setSource(false);
    onNavigate(id);
  };
  const pick = (step: CompositionStep) => {
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
    setFocusId(id);
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
    writable: writable && !stale,
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
      if (draft?.stepId === step.id && draft.arguments) return draft.arguments;
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
      if (next) changeDraft({ ...next, expression: value });
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
  return (
    <NodeBindingContext.Provider value={actions}>
      <section className="function-composer" aria-label="Function composer" data-testid="function-composer">
        <header className="function-composer__header">
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={palette ? 'Hide palette' : 'Show palette'}
            onClick={() => setPalette(!palette)}
          >
            {palette ? <PanelLeftClose /> : <PanelLeftOpen />}
          </Button>
          {breadcrumbs.current.length > 0 && (
            <Button size="xs" variant="ghost" onClick={() => onNavigate(breadcrumbs.current.pop()!)}>
              <ArrowLeft className="size-3" />
              Parent
            </Button>
          )}
          <strong className="truncate">
            {creating ? 'New composition' : identity ? identity.split('#')[0]?.split('.').pop() : 'Function composer'}
          </strong>
          <span className="function-composer__save-state">{saveBusy ? 'Saving…' : saveLabel}</span>
          <Button size="xs" variant="ghost" disabled={saveBusy} onClick={() => void save()}>
            Save
          </Button>
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
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={details ? 'Hide details' : 'Show details'}
            onClick={() => setDetails(!details)}
          >
            {details ? <PanelRightClose /> : <PanelRightOpen />}
          </Button>
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
              if (workflow.function)
                setCreatedId(makeNodeId(workflow.function.namespace, workflow.function.name, 'RosettaFunction'));
            }}
          />
        ) : (
          <div className="function-composer__body" data-palette={palette} data-details={details}>
            {palette && (
              <aside className="function-composer__palette studio-scroll" aria-label="Composition palette">
                <Input
                  aria-label="Search functions and primitives"
                  placeholder="Search functions & primitives"
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
                <h2>Primitives</h2>
                {(['Expression', 'For each', 'Output'] as const)
                  .filter((name) => name.toLowerCase().includes(query.toLowerCase()))
                  .map((name) => (
                    <Button
                      key={name}
                      size="sm"
                      variant="ghost"
                      disabled={
                        !composition?.supported ||
                        (name !== 'Output' && (!writable || Boolean(draft) || signaturePending))
                      }
                      onClick={() =>
                        name === 'Output'
                          ? pick(composition!.steps.find((step) => step.kind === 'return')!)
                          : void beginAdd(undefined, undefined, name === 'For each')
                      }
                    >
                      {name}
                    </Button>
                  ))}
                <h2>
                  Functions <span>{filtered.length}</span>
                </h2>
                {!filtered.length && <p>No matching functions.</p>}
                <div className="function-composer__catalog">
                  {filtered.slice(0, 100).map((option) => (
                    <div key={option.value} className="function-composer__function">
                      <button
                        type="button"
                        aria-label={`Open ${option.label} ${option.namespace ?? ''}`}
                        title={[
                          `${option.namespace}.${option.label}`,
                          signatureLabel(option.value),
                          callable.get(option.value)?.documentation
                        ]
                          .filter(Boolean)
                          .join('\n')}
                        onClick={() => navigate(option.value)}
                      >
                        <Workflow className="size-3" />
                        <span>
                          <strong>{option.label}</strong> <small>{option.namespace}</small>
                        </span>
                      </button>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Add ${option.label}`}
                        title="Add function call"
                        disabled={!writable || Boolean(draft) || signaturePending}
                        draggable={writable && !draft}
                        onDragStart={(event) => event.dataTransfer.setData(MIME, option.value)}
                        onClick={() => void beginAdd(option.value)}
                      >
                        <Plus className="size-3" />
                      </Button>
                    </div>
                  ))}
                  {filtered.length > 100 && <p>Search to narrow the {filtered.length} functions.</p>}
                </div>
              </aside>
            )}
            <section ref={setCanvasElement} className="function-composer__canvas" aria-label="Composition canvas">
              {editor && (
                <div className="function-composer__view" role="group" aria-label="Composition view">
                  <Button size="xs" variant="ghost" aria-pressed={!source} onClick={() => setSource(false)}>
                    <Network className="size-3" />
                    Canvas
                  </Button>
                  <Button size="xs" variant="ghost" aria-pressed={source} onClick={() => setSource(true)}>
                    <Code className="size-3" />
                    Source
                  </Button>
                  {!composition && presented && (
                    <span className="function-composer__pending" role="status">
                      Updating…
                    </span>
                  )}
                </div>
              )}
              {!editor ? (
                <div className="function-composer__empty">
                  <Workflow />
                  <h2>Compose a Rune function</h2>
                  <p>Select a function from the palette or create a composition.</p>
                  <Button onClick={() => setCreating(true)}>New composition</Button>
                </div>
              ) : source || (presented && !presented.supported) ? (
                <div className="function-composer__source studio-scroll">
                  {!presented?.supported && (
                    <div className="function-composer__notice">
                      <h2>{presented?.optedIn ? 'Source-only composition' : 'Ordinary Rune function'}</h2>
                      <p>
                        {presented?.optedIn
                          ? 'This body stays in Source to preserve its semantics.'
                          : 'Callable as a step. Add the rune.studio.composition annotation to edit its body on the canvas.'}
                      </p>
                      {presented?.reasons.map((reason, index) => (
                        <p key={index}>
                          Line {file!.content.slice(0, reason.region.from).split('\n').length}: {reason.message}
                        </p>
                      ))}
                    </div>
                  )}
                  <ExpressionWorkspace {...editor} />
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
                <div className="function-composer__graph">
                  <ReactFlow<ComposerNode>
                    nodes={graphNodes}
                    edges={edges}
                    nodeTypes={NODE_TYPES}
                    nodesConnectable={false}
                    deleteKeyCode={null}
                    fitViewOptions={FIT}
                    proOptions={{ hideAttribution: true }}
                    onMoveEnd={(_, viewport) => viewports.current.set(viewKey, viewport)}
                    onNodeClick={(_, node) => pick(node.data.step)}
                    onNodesChange={(changes) => {
                      // Expanding binding controls may move this rank. Keep its actions reachable.
                      if (
                        variablesOpen &&
                        changes.some((change) => change.type === 'dimensions') &&
                        nodes.some((node) => node.id === selected && node.measured?.height)
                      )
                        setFocusId(selected);
                      setNodes((previous) => {
                        const next = applyNodeChanges(changes, withPreview(previous));
                        return changes.some((change) => change.type === 'dimensions')
                          ? layoutNodes(next, edges, vertical, positions.current.get(viewKey))
                          : next;
                      });
                    }}
                    onNodeDragStop={(_, node) => {
                      if (draft?.adding && node.id === DRAFT_NODE) {
                        changeDraft({ ...draft, position: node.position });
                        return;
                      }
                      const saved = positions.current.get(viewKey) ?? new Map<string, XYPosition>();
                      saved.set(node.id, node.position);
                      positions.current.set(viewKey, saved);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'copy';
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const id = event.dataTransfer.getData(MIME);
                      if (catalog.some((option) => option.value === id))
                        void beginAdd(id, flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
                    }}
                    aria-label="Function dependency graph"
                  >
                    <Background gap={24} />
                    <Controls showInteractive={false} />
                  </ReactFlow>
                </div>
              )}
              {variablesOpen && !source && presented?.supported && (
                <div className="composition-variables nodrag" role="region" aria-label="Available variables">
                  <div className="composition-variables__header">
                    <strong>Variables</strong>
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
                  <p>Drag a variable to a node input or output. Or select a tag and use Bind selected.</p>
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
                          onClick={() => setSelectedVariable(variable.id)}
                          onDragStart={(event) => {
                            event.dataTransfer.setData(
                              VARIABLE_MIME,
                              JSON.stringify({ owner: identity, variable: variable.id })
                            );
                            event.dataTransfer.effectAllowed = 'link';
                          }}
                        >
                          <span>{variable.name}</span>
                          <small>{variable.kind === 'variable' ? variable.type : variable.kind}</small>
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </section>
            {details && (
              <aside className="function-composer__details studio-scroll" aria-label="Composition details">
                <div className="function-composer__tabs" role="group" aria-label="Inspector view">
                  <Button size="xs" variant="ghost" aria-pressed={tab === 'step'} onClick={() => setTab('step')}>
                    Step
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    aria-pressed={tab === 'signature'}
                    onClick={() => setTab('signature')}
                  >
                    Signature & details
                  </Button>
                </div>
                {tab === 'signature' ? (
                  inspector
                ) : !presented?.supported ? (
                  <p>Use Source or Signature & details for this function.</p>
                ) : (
                  <>
                    <label className="function-composer__step-picker">
                      Step
                      <select
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
                      </select>
                    </label>
                    {selectedStep?.parameter && selectedStep.kind !== 'return' && (
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => {
                          setPortContext(selectedStep.id);
                          setDiscover(true);
                          setPalette(true);
                          setQuery('');
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
                        onClick={() => navigate(`${selectedStep.call!.identity}#RosettaFunction`)}
                      >
                        Open {selectedStep.call.identity.split('.').pop()}
                        <ArrowUpRight className="size-3" />
                      </Button>
                    )}
                    {file?.readOnly || file?.refOnly ? (
                      <p>Reference source is read-only. Use Modify in the inspector to create an editable override.</p>
                    ) : null}
                    {draft && (
                      <div className="function-composer__draft">
                        <h2>{draft.adding ? 'New variable' : draft.name}</h2>
                        <p>
                          Bind arguments and output variables directly on the node. Use the expression editor for a
                          complex value.
                        </p>
                        {!draft.callee && !draft.bindingOnly && (
                          <LeafEditor
                            key={`${identity}:${draft.region.from}:${draft.adding}`}
                            draft={draft}
                            editor={editor!}
                            onChange={(expression) => changeDraft({ ...draft, expression })}
                          />
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
              </aside>
            )}
          </div>
        )}
      </section>
    </NodeBindingContext.Provider>
  );
}

function LeafEditor({
  draft,
  editor,
  onChange
}: {
  draft: Draft;
  editor: ExpressionWorkspaceProps;
  onChange(value: string): void;
}) {
  const [scope, setScope] = useState<Awaited<ReturnType<NonNullable<ExpressionWorkspaceProps['loadScope']>>>>();
  useEffect(() => {
    let cancelled = false;
    if (editor.loadScope)
      void editor
        .loadScope(draft.scopeRegion ?? draft.region)
        .then((scope) => {
          if (!cancelled) setScope(scope);
        })
        .catch(() => {
          /* Text remains editable when scope is unavailable. */
        });
    return () => {
      cancelled = true;
    };
  }, [draft.binding, editor.loadScope]);
  const renderText = ({ value, onChange: change }: { value: string; onChange(value: string): void }) => (
    <div className="expression-code-editor">
      <SourceEditor
        hideTabs
        activeFile="/composition-draft.rosetta"
        files={[{ name: 'Step expression', path: '/composition-draft.rosetta', content: value, dirty: false }]}
        onContentChange={(_, text) => change(text)}
      />
    </div>
  );
  return scope ? (
    <ExpressionBuilder
      value={draft.expression}
      onChange={onChange}
      onBlur={() => {}}
      scope={scope}
      renderTextEditor={renderText}
    />
  ) : (
    renderText({ value: draft.expression, onChange })
  );
}
