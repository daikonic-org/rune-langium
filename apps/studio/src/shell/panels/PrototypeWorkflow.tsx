// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from 'react';
import { makeNodeId } from '@rune-langium/visual-editor/identifiers';
import { declarationKey } from '@rune-langium/core/project-contract';
import type { WorkflowDescriptor } from '@rune-langium/project-config';
import { FormPresentation } from '../../components/FormPresentation.js';
import { WorkflowLibrary } from '../../components/WorkflowLibrary.js';
import { captureWorkflowRecipe } from '../../workspace/workflow-repository.js';
import { resolveExampleType, resolvePresentationType } from '../../workspace/example-identity.js';
import { qualifiedNameFromNodeId, useEditorStore, type TypeOption } from '@rune-langium/visual-editor';
import type { FormPreviewSchema, PreviewField } from '@rune-langium/codegen/export';
import type { InstanceRecord } from '@rune-langium/codegen/instances';
import { Button } from '@rune-langium/design-system/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@rune-langium/design-system/ui/dialog';
import { WorkflowSplitter } from '../../components/WorkflowSplitter.js';
import { WorkflowTypeLink } from '../../components/WorkflowTypeLink.js';
import { WorkflowNode } from '../../components/WorkflowNode.js';
import { WorkspaceTypePicker } from '../../components/WorkspaceTypePicker.js';
import { InstancePayloadPanel } from '../../components/InstancePayloadPanel.js';
import { useInstanceStore } from '../../store/instance-store.js';
import {
  createFunctionSession,
  type FunctionSession,
  type FunctionSessionState
} from '../../store/function-session-store.js';
import { usePreviewSessionFactory } from '../providers/preview-session-context.js';
import { useProject } from '../providers/project-context.js';
import { useWorkspaceOptional } from '../providers/workspace-context.js';
import { isInstanceBindableToField } from '../../services/function-input-binding.js';
import { resolveFunctionOutputTarget } from '../../services/function-output-target.js';
import {
  workflowFieldSchema,
  workflowFieldType,
  workflowFieldChipKind,
  workflowFieldNodeId,
  workflowSchemaNodeId
} from '../../services/workflow-fields.js';
import {
  useWorkflowValidation,
  workflowValidationRetry,
  type WorkflowValidation as Validation
} from '../../services/workflow-validation.js';
import { downloadFile, sanitizeDownloadFilename } from '../../services/export.js';
import { requestPrototype } from '../../services/prototype-navigation.js';
import { usePrototypeViewStore, normalizeWorkflowWidths } from '../../store/prototype-view-store.js';
import { useWorkflowSchema } from '../../services/workflow-schema.js';
import { useWorkflowArrival } from '../../services/workflow-arrival.js';
import './prototype-workflow.css';
import { retainedWorkflowFields } from '../../services/workflow-input-compatibility.js';
import { generateUlid } from '../../services/ulid.js';
import { withInstrumentation } from '../../services/instrumentation/core.js';

const EMPTY: FunctionSessionState = {
  functionFqn: null,
  boundParameter: null,
  inputs: {},
  result: undefined,
  status: 'idle'
};
const NO_VALUES: Record<string, unknown> = {};
interface Draft {
  id: string;
  sourceId?: string;
  typeFqn: string;
  values: Record<string, unknown>;
  source: string;
}

/** Transient draft identity survives value edits but never enters a saved recipe. */
function createDraft(input: Omit<Draft, 'id'>): Draft {
  return { ...input, id: generateUlid() };
}

function InputNode({
  schema,
  field,
  state,
  onChange,
  source,
  onBind,
  onClear,
  full,
  sourceId,
  undoScope,
  onValidation
}: {
  schema: FormPreviewSchema;
  field: PreviewField;
  state: FunctionSessionState;
  onChange(values: Record<string, unknown>): void;
  sourceId?: string;
  undoScope?: FunctionSession;
  source?: string;
  onBind(): void;
  onClear(): () => void;
  full: Validation;
  onValidation(path: string, inputs: Record<string, unknown>, validation: Validation): void;
}) {
  const projected = useMemo(() => workflowFieldSchema(schema, field), [schema, field]);
  const item = field.kind === 'array' ? field.children[0] : field;
  const raw = state.inputs[field.path];
  const ownValues = useMemo(
    () => (raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : undefined),
    [raw]
  );
  const own = useWorkflowValidation(
    item.kind === 'object' && field.kind !== 'array' && ownValues ? item.referencedTypeFqn : undefined,
    ownValues ?? NO_VALUES
  );
  const diagnostics = [
    ...new Map(
      [
        ...own.diagnostics.map((d) => ({ ...d, path: d.path ? `${field.path}.${d.path}` : field.path })),
        ...full.diagnostics.filter(
          (d) => d.path === field.path || d.path.startsWith(`${field.path}.`) || d.path.startsWith(`${field.path}[`)
        )
      ].map((diagnostic) => [`${diagnostic.path}:${diagnostic.message}`, diagnostic])
    ).values()
  ];
  const pending = full.state === 'pending' || own.state === 'pending';
  const unavailable = full.state === 'unavailable' || own.state === 'unavailable';
  const validation = {
    state: pending
      ? ('pending' as const)
      : unavailable
        ? ('unavailable' as const)
        : diagnostics.length
          ? ('invalid' as const)
          : ('valid' as const),
    diagnostics,
    message: own.message ?? full.message,
    retry: workflowValidationRetry([own, full])
  };
  const validationKey = JSON.stringify(validation);
  useEffect(
    () => onValidation(field.path, state.inputs, validation),
    [field.path, state.inputs, validationKey, onValidation]
  );
  return (
    <WorkflowNode
      name={field.path}
      type={workflowFieldType(field)}
      typeKind={workflowFieldChipKind(field)}
      typeNodeId={workflowFieldNodeId(field)}
      schema={projected}
      values={state.inputs}
      onChange={onChange}
      onClear={onClear}
      undoScope={undoScope}
      onImport={(value) => {
        const items = field.kind === 'array' && Array.isArray(value) ? value : [value];
        const expectsObject = field.kind !== 'array' || item.kind === 'object';
        if (expectsObject && items.some((value) => !value || typeof value !== 'object' || Array.isArray(value)))
          throw new Error(
            field.kind === 'array'
              ? 'Import an object or an array of objects for this input.'
              : 'Import an object for this input.'
          );
        onChange({ ...state.inputs, [field.path]: field.kind === 'array' ? items : value });
      }}
      validation={validation}
      parentPath={field.kind === 'object' ? field.path : undefined}
      source={source ?? 'Manual input'}
      sourceId={sourceId}
      sourcePath={field.kind === 'array' ? `${field.path}[0]` : field.path}
      onBind={onBind}
    />
  );
}

export const PrototypeWorkflow = withInstrumentation(
  function PrototypeWorkflow({
    instanceId,
    focusedPayloadPointer,
    focusRequestId,
    bindingRequestId
  }: {
    instanceId?: string;
    bindingRequestId?: number;
    focusedPayloadPointer?: string;
    focusRequestId?: number;
  }) {
    const workspace = useWorkspaceOptional();
    const project = useProject();
    const projectRevision = project.snapshot?.revision;
    const factory = usePreviewSessionFactory();
    const [session, setSession] = useState<FunctionSession>();
    const sessionRef = useRef<FunctionSession | undefined>(undefined);
    const openingGeneration = useRef(0);
    const [opening, setOpening] = useState(false);
    const [workflowOutputs, setWorkflowOutputs] = useState<WorkflowDescriptor['outputs']>({});
    useEffect(() => {
      if (!factory) return;
      const next = createFunctionSession(factory());
      sessionRef.current = next;
      setSession(next);
      return () => {
        ++openingGeneration.current;
        sessionRef.current?.dispose();
        sessionRef.current = undefined;
      };
    }, [factory, workspace?.workspaceId]);
    const state = useSyncExternalStore(
      (listener) => session?.subscribe(listener) ?? (() => {}),
      () => session?.getState() ?? EMPTY
    );
    const instances = useInstanceStore((s) => s.instances);
    const prepare = useInstanceStore((s) => s.prepareInstance);
    const view = usePrototypeViewStore((s) => s.state);
    const mode = view.workflowView ?? 'flow';
    const [flowDraft, setFlowDraft] = useState<Draft>();
    const [builderDraft, setBuilderDraft] = useState<Draft>();
    const draft = mode === 'panels' ? builderDraft : flowDraft;
    const setDraft = mode === 'panels' ? setBuilderDraft : setFlowDraft;
    const [sources, setSources] = useState<Record<string, string>>({});
    const [sourceIds, setSourceIds] = useState<Record<string, string>>({});
    const [binding, setBinding] = useState<{ record?: InstanceRecord; field?: PreviewField }>();
    const seenInstance = useRef<Partial<Record<'flow' | 'panels', string>>>({});
    const stage = useRef<HTMLDivElement>(null);
    const [paths, setPaths] = useState<string[]>([]);
    const patch = usePrototypeViewStore((s) => s.patch);
    const [widths, setWidths] = useState(() => normalizeWorkflowWidths(view.workflowWidths));
    const widthRef = useRef(widths);
    const record = instanceId ? instances[instanceId] : undefined;
    useEffect(() => {
      setFlowDraft(undefined);
      setBuilderDraft(undefined);
      setSources({});
      setSourceIds({});
      setWorkflowOutputs({});
      setOpening(false);
      seenInstance.current = {};
    }, [workspace?.workspaceId]);
    const draftSchemaState = useWorkflowSchema(draft?.typeFqn);
    const draftSchema = draftSchemaState?.schema;
    useEffect(() => {
      if (!record || project.status === 'loading') return;
      if (view.bindingSurface && view.bindingSurface !== mode) return;
      const request = record.id + ':' + bindingRequestId;
      if (seenInstance.current[mode] === request) return;
      seenInstance.current[mode] = request;
      void prepare(record.id);
      if (mode === 'panels' || (!draft && !state.functionFqn))
        setDraft(
          createDraft({
            sourceId: record.id,
            typeFqn: record.typeFqn,
            values: structuredClone(record.data) as Record<string, unknown>,
            source: record.name
          })
        );
      else setBinding({ record });
    }, [record, prepare, draft, state.functionFqn, bindingRequestId, project.status, mode, view.bindingSurface]);
    const standaloneValidation = useWorkflowValidation(draft?.typeFqn, draft?.values ?? NO_VALUES);
    const functionValidation = useWorkflowValidation(state.schema?.targetId, state.inputs, true);
    const [inputChecks, setInputChecks] = useState<
      Record<string, { inputs: Record<string, unknown>; validation: Validation }>
    >({});
    const receiveInputValidation = useCallback(
      (path: string, inputs: Record<string, unknown>, validation: Validation) =>
        setInputChecks((previous) => {
          const old = previous[path];
          if (old?.inputs === inputs && JSON.stringify(old.validation) === JSON.stringify(validation)) return previous;
          return { ...previous, [path]: { inputs, validation } };
        }),
      []
    );
    const objectFields = useMemo(
      () => state.schema?.fields.filter((f) => f.kind === 'object' || f.kind === 'array') ?? [],
      [state.schema]
    );
    const primitiveSchema = useMemo(
      () =>
        state.schema
          ? { ...state.schema, fields: state.schema.fields.filter((f) => f.kind !== 'object' && f.kind !== 'array') }
          : undefined,
      [state.schema]
    );
    const aggregateValidation = useMemo<Validation>(() => {
      const checks = [
        functionValidation,
        ...objectFields.map((field) =>
          inputChecks[field.path]?.inputs === state.inputs
            ? inputChecks[field.path]!.validation
            : { state: 'pending' as const, diagnostics: [] }
        )
      ];
      const unavailable = checks.find((check) => check.state === 'unavailable');
      const diagnostics = [
        ...new Map(checks.flatMap((check) => check.diagnostics).map((d) => [`${d.path}:${d.message}`, d])).values()
      ];
      return {
        state: checks.some((check) => check.state === 'pending')
          ? 'pending'
          : unavailable
            ? 'unavailable'
            : diagnostics.length
              ? 'invalid'
              : functionValidation.state,
        diagnostics,
        message: unavailable?.message,
        retry: workflowValidationRetry(checks)
      };
    }, [functionValidation, objectFields, inputChecks, state.inputs]);
    const outputTarget = useMemo(
      () => resolveFunctionOutputTarget(workspace?.models ?? [], state.functionFqn, state.schema),
      [workspace?.models, state.functionFqn, state.schema]
    );
    const [previousResult, setPreviousResult] = useState<{
      workspaceId: string | undefined;
      functionFqn: string;
      inputs: string;
      value: unknown;
    }>();
    const resultField = mode === 'flow' ? state.schema?.result : undefined;
    const resultSchema = useMemo(
      () => (state.schema && resultField ? workflowFieldSchema(state.schema, resultField) : undefined),
      [state.schema, resultField]
    );
    const resultValues = useMemo(
      () => (resultField ? { [resultField.path]: state.result } : NO_VALUES),
      [resultField, state.result]
    );
    const functionSelected = mode === 'flow' && state.functionFqn !== null;
    const ready = functionSelected
      ? state.status === 'succeeded' && aggregateValidation.state === 'valid'
      : !!draft && standaloneValidation.state === 'valid';
    const payload = functionSelected ? state.result : draft?.values;
    // History is presentation only: never restore a stale result to the executable session or payload graph.
    const retainedResult =
      mode === 'flow' &&
      previousResult &&
      previousResult.workspaceId === workspace?.workspaceId &&
      previousResult.functionFqn === state.functionFqn &&
      previousResult.inputs === JSON.stringify(state.inputs)
        ? previousResult
        : undefined;
    const nodes = useEditorStore((s) => s.nodesById);
    const edges = useEditorStore((s) => s.edges);
    // Use linked, kind-qualified graph edges for candidate discovery; schema assignment is checked again below.
    const compatible = useMemo(() => {
      const types = new Set(
        [
          draft?.typeFqn,
          ...objectFields.map((field) => {
            const item = field.kind === 'array' ? field.children[0] : field;
            return item.kind === 'object' ? item.referencedTypeFqn : undefined;
          })
        ].filter(Boolean)
      );
      if (!types.size) return undefined;
      const accepted = new Set(
        [...nodes.values()]
          .filter((n) => types.has(qualifiedNameFromNodeId(n.id)) && n.data.$type !== 'RosettaFunction')
          .map((n) => n.id)
      );
      for (let changed = true; changed;) {
        changed = false;
        for (const edge of edges)
          if (edge.data?.kind === 'extends' && accepted.has(edge.source) && !accepted.has(edge.target)) {
            accepted.add(edge.target);
            changed = true;
          } else if (edge.data?.kind === 'type-alias-ref' && accepted.has(edge.target) && !accepted.has(edge.source)) {
            accepted.add(edge.source);
            changed = true;
          }
      }
      return new Set(
        edges
          .filter(
            (edge) =>
              edge.data?.kind === 'attribute-ref' &&
              edge.data.label !== 'output' &&
              accepted.has(edge.target) &&
              nodes.get(edge.source)?.data.$type === 'RosettaFunction'
          )
          .map((edge) => edge.source)
      );
    }, [draft?.typeFqn, nodes, edges, objectFields]);
    const filterFunctionOption = useCallback(
      (option: TypeOption) => !compatible || compatible.has(option.value),
      [compatible]
    );
    const previousInputs = useRef<
      | {
          schema: FormPreviewSchema;
          refresh?: boolean;
          inputs: Record<string, unknown>;
          sources: Record<string, string>;
          sourceIds: Record<string, string>;
        }
      | undefined
    >(undefined);
    const pendingSeed = useRef<Draft | undefined>(undefined);
    const selectFunction = useCallback(
      (option: TypeOption | null) => {
        ++openingGeneration.current;
        setOpening(false);
        if (!session) return;
        if (!option) {
          const field =
            objectFields.find((f) => f.path === state.boundParameter) ??
            (objectFields.length === 1 ? objectFields[0] : undefined);
          if (
            field?.kind === 'object' &&
            field.referencedTypeFqn &&
            state.inputs[field.path] &&
            typeof state.inputs[field.path] === 'object'
          )
            setDraft(
              createDraft({
                typeFqn: field.referencedTypeFqn,
                values: structuredClone(state.inputs[field.path]) as Record<string, unknown>,
                source: sources[field.path] ?? 'Workflow input',
                sourceId: sourceIds[field.path]
              })
            );
          pendingSeed.current = undefined;
          previousInputs.current = undefined;
          void session.selectFunction(null);
          return;
        }
        const refresh = qualifiedNameFromNodeId(option.value) === state.functionFqn;
        previousInputs.current = state.schema
          ? { schema: state.schema, refresh, inputs: state.inputs, sources, sourceIds }
          : undefined;
        pendingSeed.current = refresh ? undefined : draft;
        if (!refresh) {
          setSources({});
          setSourceIds({});
        }
        void session.selectFunction(qualifiedNameFromNodeId(option.value), option.value);
      },
      [session, state, draft, sources, sourceIds, objectFields]
    );
    // Hydrating a closure republishes models without changing editable source.
    // Restart only for source/cohort changes, not while users fill the form.
    const sourceRevision = useMemo(
      () =>
        JSON.stringify([
          projectRevision,
          workspace?.files.filter((file) => !file.bundleId).map((file) => [file.path, file.content]),
          [
            ...new Set(
              workspace?.files.filter((file) => file.bundleId).map((file) => `${file.bundleId}:${file.bundleVersion}`)
            )
          ].sort()
        ]),
      [workspace?.files, projectRevision]
    );
    const lastSourceRevision = useRef(sourceRevision);
    useEffect(() => {
      if (mode !== 'flow' || lastSourceRevision.current === sourceRevision) return;
      lastSourceRevision.current = sourceRevision;
      if (state.functionFqn)
        selectFunction({
          value: state.schema?.targetId ?? state.functionFqn,
          label: state.schema?.title ?? state.functionFqn,
          kind: 'func'
        });
    }, [sourceRevision, selectFunction, state.functionFqn, state.schema, mode]);
    const [drag, setDrag] = useState<{ label: string; x: number; y: number }>();
    const dragCleanup = useRef<(() => void) | undefined>(undefined);
    useEffect(() => () => dragCleanup.current?.(), []);
    const beginFunctionDrag = (event: ReactPointerEvent, option: TypeOption) => {
      if (event.button !== 0) return;
      event.preventDefault();
      dragCleanup.current?.();
      const x = event.clientX,
        y = event.clientY,
        id = event.pointerId;
      let moved = false;
      const move = (e: PointerEvent) => {
        if (e.pointerId !== id) return;
        if (!moved && Math.hypot(e.clientX - x, e.clientY - y) < 7) return;
        moved = true;
        setDrag({ label: option.label, x: e.clientX, y: e.clientY });
      };
      const cleanup = () => {
        document.removeEventListener('pointermove', move, true);
        document.removeEventListener('pointerup', up, true);
        document.removeEventListener('pointercancel', cancel, true);
        setDrag(undefined);
        dragCleanup.current = undefined;
      };
      const up = (e: PointerEvent) => {
        if (e.pointerId !== id) return;
        const box = stage.current?.querySelector('.workflow-function')?.getBoundingClientRect();
        cleanup();
        if (moved) {
          const stop = (click: Event) => {
            click.preventDefault();
            click.stopImmediatePropagation();
          };
          document.addEventListener('click', stop, { capture: true, once: true });
          setTimeout(() => document.removeEventListener('click', stop, true), 0);
          if (box && e.clientX >= box.left && e.clientX <= box.right && e.clientY >= box.top && e.clientY <= box.bottom)
            selectFunction(option);
        }
      };
      const cancel = (e: PointerEvent) => {
        if (e.pointerId === id) cleanup();
      };
      dragCleanup.current = cleanup;
      document.addEventListener('pointermove', move, true);
      document.addEventListener('pointerup', up, true);
      document.addEventListener('pointercancel', cancel, true);
    };
    useEffect(() => {
      if (!session || !state.schema || state.schemaStatus === 'loading') return;
      const previous = previousInputs.current;
      previousInputs.current = undefined;
      if (previous) {
        const fields = retainedWorkflowFields(previous.schema, state.schema);
        if (fields.length) {
          if (!previous.refresh)
            session.setInputs({
              ...state.inputs,
              ...Object.fromEntries(fields.map((field) => [field.path, previous.inputs[field.path]]))
            });
          const retained = new Set(fields.map((field) => field.path));
          setSources((current) =>
            Object.fromEntries(
              Object.entries(previous.refresh ? current : previous.sources).filter(([path]) => retained.has(path))
            )
          );
          setSourceIds((current) =>
            Object.fromEntries(
              Object.entries(previous.refresh ? current : previous.sourceIds).filter(([path]) => retained.has(path))
            )
          );
          pendingSeed.current = undefined;
          return;
        }
      }
      const seed = pendingSeed.current;
      if (!seed) return;
      pendingSeed.current = undefined;
      const candidate = {
        id: seed.sourceId ?? '',
        typeFqn: seed.typeFqn,
        data: seed.values,
        name: seed.source
      } as InstanceRecord;
      const fields = state.schema.fields.filter((f) =>
        isInstanceBindableToField(candidate, f, workspace?.models ?? [])
      );
      if (fields.length === 1) {
        session.bindInstance(fields[0]!.path, candidate);
        setSources({ [fields[0]!.path]: seed.source });
        if (seed.sourceId) setSourceIds({ [fields[0]!.path]: seed.sourceId });
      } else if (fields.length > 1) setBinding({ record: candidate });
    }, [session, state.schema, state.schemaStatus, workspace?.models]);
    const rootRef = useRef<HTMLElement>(null);
    const arrivalSchema = useMemo(
      () => ({
        draftSchema,
        schema: mode === 'flow' ? state.schema : undefined,
        sourceIds: mode === 'flow' ? sourceIds : {}
      }),
      [draftSchema, state.schema, sourceIds, mode]
    );
    useWorkflowArrival(rootRef, instanceId, focusedPayloadPointer, focusRequestId, arrivalSchema);
    useEffect(() => {
      const el = stage.current;
      if (!el) return;
      const draw = () => {
        const box = el.getBoundingClientRect(),
          fn = el.querySelector<HTMLElement>('[data-workflow-node="function"]'),
          out = el.querySelector<HTMLElement>('[data-workflow-node="output"]');
        if (!fn || !out || mode !== 'flow') {
          setPaths([]);
          return;
        }
        const anchor = (node: HTMLElement, right: boolean) => {
          const r = node.getBoundingClientRect();
          return {
            x: (right ? r.right : r.left) - box.left + el.scrollLeft,
            y: r.top - box.top + Math.min(58, r.height / 2) + el.scrollTop
          };
        };
        const edge = (a: { x: number; y: number }, b: { x: number; y: number }) => {
          const d = Math.max(20, (b.x - a.x) / 2);
          return `M${a.x},${a.y} C${a.x + d},${a.y} ${b.x - d},${b.y} ${b.x},${b.y}`;
        };
        const inputs = [...el.querySelectorAll<HTMLElement>('.workflow-inputs>.workflow-node')];
        setPaths([
          ...inputs.map((node) => edge(anchor(node, true), anchor(fn, false))),
          edge(anchor(fn, true), anchor(out, false))
        ]);
      };
      const observer = new ResizeObserver(draw);
      [el, ...el.querySelectorAll<HTMLElement>('.workflow-node')].forEach((node) => observer.observe(node));
      draw();
      return () => observer.disconnect();
    }, [state.schema, draftSchema, mode, objectFields.length, widths]);
    const bind = (candidate: InstanceRecord, field?: PreviewField) => {
      if (field && session) {
        session.bindInstance(field.path, candidate);
        setSources((s) => ({ ...s, [field.path]: candidate.name }));
        setSourceIds((s) => ({ ...s, [field.path]: candidate.id }));
      } else
        setDraft(
          createDraft({
            sourceId: candidate.id,
            typeFqn: candidate.typeFqn,
            values: structuredClone(candidate.data) as Record<string, unknown>,
            source: candidate.name
          })
        );
      setBinding(undefined);
    };
    const setColumn = (index: number, value: number, commit = false) => {
      const next: [number, number] = [...widthRef.current];
      next[index] = Math.max(22, Math.min(40, value, 76 - next[1 - index]!));
      widthRef.current = next;
      setWidths(next);
      if (commit) patch({ workflowWidths: next });
    };
    const captureRecipe = (id: string, name: string): WorkflowDescriptor => {
      const functionIdentity =
        state.functionFqn && workspace
          ? resolveExampleType(workspace, { typeFqn: state.functionFqn }, 'RosettaFunction')
          : undefined;
      if (state.functionFqn && !functionIdentity)
        throw new Error('The function identity is unavailable or ambiguous. The draft is retained.');
      const field = resultField?.kind === 'array' ? resultField.children[0] : resultField;
      const outputType = workspace
        ? field?.typeSymbol
          ? resolvePresentationType(workspace, field.typeSymbol)
          : draft
            ? resolveExampleType(workspace, { typeFqn: draft.typeFqn })
            : undefined
        : undefined;
      const outputPath = resultField?.path ?? 'output';
      return captureWorkflowRecipe({
        id,
        name,
        ...(functionIdentity ? { function: functionIdentity } : {}),
        inputs: functionIdentity ? state.inputs : draft ? { input: draft.values } : {},
        sourceIds: functionIdentity ? sourceIds : draft?.sourceId ? { input: draft.sourceId } : {},
        records: instances,
        outputs: {
          [outputPath]: {
            name: workflowOutputs[outputPath]?.name ?? outputPath,
            ...(outputType ? { type: outputType } : {})
          }
        }
      });
    };
    const openRecipe = async (workflow: WorkflowDescriptor) => {
      if (!factory || !workspace) throw new Error('The workflow runtime is not available yet.');
      const version = ++openingGeneration.current;
      setOpening(true);
      const next = createFunctionSession(factory());
      let committed = false;
      try {
        const identity =
          workflow.function &&
          resolveExampleType(
            workspace,
            { typeFqn: workflow.function.namespace + '.' + workflow.function.name, typeIdentity: workflow.function },
            'RosettaFunction'
          );
        if (workflow.function && (!identity || declarationKey(identity) !== declarationKey(workflow.function)))
          throw new Error('The saved function is unavailable. Its recipe is retained.');
        await useInstanceStore.getState().loadInstancesFromOpfs();
        const records = useInstanceStore.getState().instances;
        const values: Record<string, unknown> = {},
          restoredIds: Record<string, string> = {},
          restoredSources: Record<string, string> = {};
        for (const [path, binding] of Object.entries(workflow.inputs)) {
          if (binding.kind === 'literal') values[path] = structuredClone(binding.value);
          else {
            const record = records[binding.exampleId];
            if (!record) throw new Error('A saved input example is unavailable. Its binding is retained.');
            values[path] = structuredClone(record.data);
            restoredIds[path] = record.id;
            restoredSources[path] = record.name;
          }
        }
        let nextDraft: Draft | undefined;
        if (identity) {
          await next.selectFunction(
            identity.namespace + '.' + identity.name,
            makeNodeId(identity.namespace, identity.name, 'RosettaFunction')
          );
          if (!next.getState().schema)
            throw new Error(next.getState().error ?? 'The saved function schema is unavailable.');
          next.setInputs(values);
          for (const [path, id] of Object.entries(restoredIds)) next.bindInstance(path, records[id]!);
        } else {
          const entries = Object.entries(values);
          const type = Object.values(workflow.outputs).find((output) => output.type)?.type;
          if (entries.length !== 1 || !type)
            throw new Error('Bypass needs one typed input. The complete recipe is retained.');
          const [path, value] = entries[0]!;
          nextDraft = createDraft({
            typeFqn: type.namespace + '.' + type.name,
            values: structuredClone(value) as Record<string, unknown>,
            source: restoredSources[path] ?? workflow.name,
            sourceId: restoredIds[path]
          });
        }
        if (version !== openingGeneration.current)
          throw new DOMException('Workflow opening was superseded.', 'AbortError');
        pendingSeed.current = undefined;
        previousInputs.current = undefined;
        setSources(restoredSources);
        setSourceIds(restoredIds);
        setDraft(nextDraft);
        setWorkflowOutputs(workflow.outputs);
        sessionRef.current?.dispose();
        sessionRef.current = next;
        setSession(next);
        committed = true;
      } finally {
        if (!committed) next.dispose();
        if (version === openingGeneration.current) setOpening(false);
      }
    };
    const resultNode = (
      <div data-workflow-node="output">
        <WorkflowNode
          name={
            (mode === 'flow' ? workflowOutputs[resultField?.path ?? 'output']?.name : undefined) ??
            resultField?.path ??
            'output'
          }
          type={resultField ? workflowFieldType(resultField) : draft?.typeFqn.split('.').slice(-1)[0]}
          typeNodeId={
            resultField ? workflowFieldNodeId(resultField) : draftSchema ? workflowSchemaNodeId(draftSchema) : undefined
          }
          kind="output"
          typeKind={resultField ? workflowFieldChipKind(resultField) : undefined}
          values={functionSelected ? resultValues : (draft?.values ?? NO_VALUES)}
          schema={ready ? (functionSelected ? resultSchema : draftSchema) : undefined}
          parentPath={functionSelected && resultField?.kind === 'object' ? resultField.path : undefined}
          readOnly
        >
          {ready ? (
            <>
              <InstancePayloadPanel
                payload={{ kind: functionSelected ? 'result' : 'instance', value: payload }}
                onExport={async () =>
                  downloadFile(
                    JSON.stringify(payload, null, 2),
                    sanitizeDownloadFilename(`${resultField?.path ?? 'payload'}.json`, 'payload.json'),
                    'application/json'
                  )
                }
              />
              {(functionSelected ? outputTarget?.typeFqn : draft?.typeFqn) &&
              payload &&
              typeof payload === 'object' &&
              !Array.isArray(payload) &&
              workspace?.workspaceId ? (
                <Button
                  variant="outline"
                  size="xs"
                  className="workflow-node__save"
                  onClick={() =>
                    requestPrototype(workspace.workspaceId!, {
                      kind: 'create',
                      seed: {
                        typeFqn: functionSelected ? outputTarget!.typeFqn : draft!.typeFqn,
                        data: structuredClone(payload)
                      }
                    })
                  }
                >
                  Save as example…
                </Button>
              ) : null}
            </>
          ) : retainedResult ? (
            <div className="space-y-2 p-2">
              <p role="status" className="text-xs text-muted-foreground">
                Previous result — execute again to refresh. This result cannot be saved as a current example.
              </p>
              <pre
                aria-label="Previous function result"
                className="studio-scroll max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-background p-2 font-mono text-xs"
              >
                {JSON.stringify(retainedResult.value, null, 2)}
              </pre>
            </div>
          ) : (
            <p role="status" className="p-3 text-xs text-muted-foreground">
              {functionSelected
                ? (state.error ??
                  (state.status === 'running'
                    ? 'Preparing function…'
                    : aggregateValidation.state === 'invalid'
                      ? 'Resolve input checks before executing.'
                      : 'Execute to generate an output.'))
                : draft
                  ? 'Resolve object validation before exporting.'
                  : mode === 'panels'
                    ? 'Choose an object type or select an example to begin.'
                    : 'Add or select an input object to begin.'}
            </p>
          )}
        </WorkflowNode>
      </div>
    );
    return (
      <section ref={rootRef} className="workflow" aria-label="Prototype workflow" aria-busy={opening}>
        <div hidden={mode !== 'flow'} className="shrink-0">
          <WorkflowLibrary
            onNew={() => {
              ++openingGeneration.current;
              setOpening(false);
              pendingSeed.current = undefined;
              previousInputs.current = undefined;
              setFlowDraft(undefined);
              setSources({});
              setSourceIds({});
              setWorkflowOutputs({});
              setPreviousResult(undefined);
              setBinding(undefined);
              void session?.selectFunction(null);
            }}
            capture={captureRecipe}
            open={openRecipe}
            onBeforeSave={() => {
              if (ready && state.functionFqn)
                setPreviousResult({
                  workspaceId: workspace?.workspaceId,
                  functionFqn: state.functionFqn,
                  inputs: JSON.stringify(state.inputs),
                  value: structuredClone(state.result)
                });
            }}
            disabled={mode !== 'flow' || !session || (!flowDraft && !state.functionFqn)}
          />
        </div>
        {mode === 'panels' ? (
          <div className="workflow-toolbar">
            <WorkspaceTypePicker
              label="Choose an object type"
              appearance="chip"
              value={draft?.typeFqn ?? null}
              filterKinds={['data', 'choice']}
              onSelect={() => {}}
              onSelectOption={(option) => {
                if (option)
                  setBuilderDraft(
                    createDraft({
                      typeFqn: option.namespace ? `${option.namespace}.${option.label}` : option.label,
                      values: {},
                      source: 'Manual input'
                    })
                  );
              }}
            />
          </div>
        ) : null}
        <FormPresentation showToolbar={false} showNotices>
          {null}
        </FormPresentation>
        {drag ? (
          <div className="workflow-drag-ghost" style={{ left: drag.x + 12, top: drag.y + 12 }}>
            {drag.label}
          </div>
        ) : null}
        <fieldset disabled={opening} className="contents">
          <div
            ref={stage}
            className={`workflow-stage workflow-stage--${mode}`}
            style={
              {
                '--workflow-input-width': `${widths[0]}%`,
                '--workflow-function-width': `${widths[1]}%`
              } as CSSProperties
            }
          >
            <svg className="workflow-connectors" aria-hidden="true">
              {paths.map((path, i) => (
                <path key={i} d={path} />
              ))}
            </svg>
            <div className="workflow-inputs">
              {functionSelected && state.schema ? (
                objectFields.map((field) => (
                  <InputNode
                    key={`${state.functionFqn}:${field.path}`}
                    field={field}
                    schema={state.schema!}
                    state={state}
                    full={functionValidation}
                    onValidation={receiveInputValidation}
                    source={sources[field.path]}
                    sourceId={sourceIds[field.path]}
                    undoScope={session}
                    onChange={(values) => session?.setInputs(values)}
                    onClear={() => {
                      const before = structuredClone(state.inputs[field.path]);
                      session?.setInputs({
                        ...session.getState().inputs,
                        [field.path]: field.kind === 'array' ? [] : {}
                      });
                      return () => session?.setInputs({ ...session.getState().inputs, [field.path]: before });
                    }}
                    onBind={() => setBinding({ field })}
                  />
                ))
              ) : draft ? (
                <WorkflowNode
                  key={`${mode}:${draft.id}`}
                  name="input"
                  typeNodeId={draftSchema ? workflowSchemaNodeId(draftSchema) : undefined}
                  type={draft.typeFqn.split('.').slice(-1)[0]}
                  schema={draftSchema}
                  values={draft.values}
                  onChange={(values) =>
                    setDraft({ ...draft, values, source: mode === 'panels' ? 'Object draft' : 'Workflow draft' })
                  }
                  onClear={() => {
                    const before = draft;
                    setDraft({ ...draft, values: {}, source: 'Manual input' });
                    return () => setDraft(before);
                  }}
                  source={draft.source}
                  sourceId={draft.sourceId}
                  validation={standaloneValidation}
                  onBind={() => setBinding({})}
                >
                  {!draftSchema ? (
                    <div className="space-y-2 p-3 text-xs">
                      <p role={draftSchemaState.error ? 'alert' : 'status'}>
                        {draftSchemaState.error ?? 'Preparing input schema…'}
                      </p>
                      {draftSchemaState.error ? (
                        <Button variant="outline" size="xs" onClick={draftSchemaState.retry}>
                          Retry input schema
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </WorkflowNode>
              ) : (
                <div className="workflow-empty">
                  {mode === 'panels'
                    ? 'Choose an object type, or select an example below.'
                    : 'Add an object or choose a function.'}
                </div>
              )}
            </div>
            {(mode === 'flow' ? [0, 1] : []).map((index) => (
              <WorkflowSplitter
                key={index}
                label={index ? 'Resize function and output' : 'Resize inputs and function'}
                className={`workflow-splitter workflow-splitter--${index}`}
                container={stage}
                value={widths[index]!}
                max={Math.min(40, 76 - widths[1 - index]!)}
                onChange={(value) => setColumn(index, value)}
                onCommit={(value) => setColumn(index, value, true)}
              />
            ))}
            {mode === 'flow' ? (
              <div className="workflow-function" data-workflow-node="function">
                <WorkflowNode
                  name={state.schema?.title ?? 'Transform'}
                  kind="function"
                  typeNodeId={state.schema ? workflowSchemaNodeId(state.schema) : undefined}
                  validationRoot={rootRef}
                  type={undefined}
                  schema={primitiveSchema?.fields.length ? primitiveSchema : undefined}
                  values={state.inputs}
                  onChange={state.schema ? (values) => session?.setInputs(values) : undefined}
                  validation={
                    functionSelected
                      ? aggregateValidation
                      : {
                          state: 'unchecked',
                          diagnostics: [],
                          message: 'No function selected. The input becomes the output directly.'
                        }
                  }
                  actions={
                    functionSelected ? (
                      <Button
                        size="xs"
                        disabled={
                          !session ||
                          state.status === 'running' ||
                          state.schemaStatus === 'unavailable' ||
                          aggregateValidation.state !== 'valid' ||
                          !!state.schema?.executionUnavailable
                        }
                        onClick={() => void session?.run()}
                      >
                        {state.status === 'running' ? 'Executing…' : 'Execute'}
                      </Button>
                    ) : null
                  }
                >
                  <div className="workflow-node__body space-y-2">
                    <WorkspaceTypePicker
                      label="Choose a function"
                      appearance="chip"
                      value={state.functionFqn}
                      filterKinds={['func']}
                      allowClear
                      optionFilter={filterFunctionOption}
                      onOptionPointerDown={beginFunctionDrag}
                      onSelect={() => {}}
                      onSelectOption={selectFunction}
                    />
                    {state.schema ? (
                      <div className="space-y-2 text-xs text-muted-foreground">
                        {state.schema.fields.map((f) => (
                          <p key={f.path} className="workflow-parameter">
                            <span>{f.path}</span>
                            <WorkflowTypeLink
                              nodeId={workflowFieldNodeId(f)}
                              name={workflowFieldType(f)}
                              kind={workflowFieldChipKind(f)}
                            />
                          </p>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        No transform is required. Choose one compatible function to execute.
                      </p>
                    )}
                    {state.schema?.executionUnavailable ? (
                      <p role="status" className="text-xs text-muted-foreground">
                        {state.schema.executionUnavailable}
                      </p>
                    ) : null}
                    {state.error ? (
                      <p role="alert" className="text-xs text-destructive">
                        {state.error}
                        {state.schemaStatus === 'unavailable' && state.functionFqn ? (
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() =>
                              selectFunction({
                                value: state.schema?.targetId ?? state.functionFqn!,
                                label: state.schema?.title ?? state.functionFqn!,
                                kind: 'func'
                              })
                            }
                          >
                            Retry schema
                          </Button>
                        ) : null}
                      </p>
                    ) : null}
                  </div>
                </WorkflowNode>
              </div>
            ) : null}
            <div className="workflow-output">{resultNode}</div>
          </div>
        </fieldset>
        <Dialog open={!!binding} onOpenChange={(open) => !open && setBinding(undefined)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{binding?.record ? 'Use object as input' : 'Use stored object'}</DialogTitle>
              <DialogDescription>Choose an input binding. Stored data remains unchanged.</DialogDescription>
            </DialogHeader>
            <div className="studio-scroll max-h-80 overflow-auto space-y-1">
              {binding?.record ? (
                mode === 'flow' && state.schema ? (
                  state.schema.fields
                    .filter((f) => isInstanceBindableToField(binding.record!, f, workspace?.models ?? []))
                    .map((field) => (
                      <Button
                        key={field.path}
                        variant="ghost"
                        className="w-full justify-between"
                        onClick={() => bind(binding.record!, field)}
                      >
                        {field.path}
                        <span className="text-xs text-muted-foreground">{workflowFieldType(field)}</span>
                      </Button>
                    ))
                ) : (
                  <Button onClick={() => bind(binding.record!)}>Use as input</Button>
                )
              ) : (
                Object.values(instances)
                  .filter(
                    (r) => !binding?.field || isInstanceBindableToField(r, binding.field, workspace?.models ?? [])
                  )
                  .map((r) => (
                    <Button
                      key={r.id}
                      variant="ghost"
                      className="w-full justify-between"
                      onClick={() => bind(r, binding?.field)}
                    >
                      {r.name}
                      <span className="text-xs text-muted-foreground">{r.typeFqn.split('.').slice(-1)[0]}</span>
                    </Button>
                  ))
              )}
            </div>
          </DialogContent>
        </Dialog>
      </section>
    );
  },
  {
    op: 'PrototypeWorkflow',
    sanitize: () => '[workflow]',
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);
