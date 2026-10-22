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
import { qualifiedNameFromNodeId, useEditorStore, TypeChip, type TypeOption } from '@rune-langium/visual-editor';
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
import { useWorkspaceOptional } from '../providers/workspace-context.js';
import { isInstanceBindableToField } from '../../services/function-input-binding.js';
import { resolveFunctionOutputTarget } from '../../services/function-output-target.js';
import { workflowFieldSchema, workflowFieldType, workflowFieldChipKind } from '../../services/workflow-fields.js';
import { useWorkflowValidation, type WorkflowValidation as Validation } from '../../services/workflow-validation.js';
import { downloadFile, sanitizeDownloadFilename } from '../../services/export.js';
import { requestPrototype } from '../../services/prototype-navigation.js';
import { usePrototypeViewStore, normalizeWorkflowWidths } from '../../store/prototype-view-store.js';
import { useWorkflowSchema } from '../../services/workflow-schema.js';
import { useWorkflowArrival } from '../../services/workflow-arrival.js';
import './prototype-workflow.css';
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
  sourceId?: string;
  typeFqn: string;
  values: Record<string, unknown>;
  source: string;
}

function InputNode({
  schema,
  field,
  state,
  onChange,
  source,
  onBind,
  full,
  sourceId,
  onValidation
}: {
  schema: FormPreviewSchema;
  field: PreviewField;
  state: FunctionSessionState;
  onChange(values: Record<string, unknown>): void;
  sourceId?: string;
  source?: string;
  onBind(): void;
  full: Validation;
  onValidation(path: string, inputs: Record<string, unknown>, validation: Validation): void;
}) {
  const projected = useMemo(() => workflowFieldSchema(schema, field), [schema, field]);
  const item = field.kind === 'array' ? field.children[0] : field;
  const raw = state.inputs[field.path];
  const ownValues = useMemo(
    () => (raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : NO_VALUES),
    [raw]
  );
  const own = useWorkflowValidation(
    item.kind === 'object' && field.kind !== 'array' ? item.referencedTypeFqn : undefined,
    ownValues
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
    message: own.message ?? full.message
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
      schema={projected}
      values={state.inputs}
      onChange={onChange}
      onImport={(value) => onChange({ ...state.inputs, [field.path]: value })}
      validation={validation}
      parentPath={field.kind === 'object' ? field.path : undefined}
      source={source ?? 'Manual input'}
      sourceId={sourceId}
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
    const factory = usePreviewSessionFactory();
    const [session, setSession] = useState<FunctionSession>();
    useEffect(() => {
      if (!factory) return;
      const next = createFunctionSession(factory());
      setSession(next);
      return () => next.dispose();
    }, [factory]);
    const state = useSyncExternalStore(
      (listener) => session?.subscribe(listener) ?? (() => {}),
      () => session?.getState() ?? EMPTY
    );
    const instances = useInstanceStore((s) => s.instances);
    const prepare = useInstanceStore((s) => s.prepareInstance);
    const [draft, setDraft] = useState<Draft>();
    const [sources, setSources] = useState<Record<string, string>>({});
    const [sourceIds, setSourceIds] = useState<Record<string, string>>({});
    const [binding, setBinding] = useState<{ record?: InstanceRecord; field?: PreviewField }>();
    const seenInstance = useRef<string | undefined>(undefined);
    const stage = useRef<HTMLDivElement>(null);
    const [paths, setPaths] = useState<string[]>([]);
    const view = usePrototypeViewStore((s) => s.state);
    const patch = usePrototypeViewStore((s) => s.patch);
    const [widths, setWidths] = useState(() => normalizeWorkflowWidths(view.workflowWidths));
    const widthRef = useRef(widths);
    const mode = view.workflowView ?? 'flow';
    const record = instanceId ? instances[instanceId] : undefined;
    const draftSchemaState = useWorkflowSchema(draft?.typeFqn);
    const draftSchema = draftSchemaState?.schema;
    useEffect(() => {
      if (!record) return;
      const request = record.id + ':' + bindingRequestId;
      if (seenInstance.current === request) return;
      seenInstance.current = request;
      void prepare(record.id);
      if (!draft && !state.functionFqn)
        setDraft({
          sourceId: record.id,
          typeFqn: record.typeFqn,
          values: structuredClone(record.data) as Record<string, unknown>,
          source: record.name
        });
      else setBinding({ record });
    }, [record, prepare, draft, state.functionFqn, bindingRequestId]);
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
        message: unavailable?.message
      };
    }, [functionValidation, objectFields, inputChecks, state.inputs]);
    const outputTarget = useMemo(
      () => resolveFunctionOutputTarget(workspace?.models ?? [], state.functionFqn, state.schema),
      [workspace?.models, state.functionFqn, state.schema]
    );
    const resultField = state.schema?.result;
    const resultSchema = useMemo(
      () => (state.schema && resultField ? workflowFieldSchema(state.schema, resultField) : undefined),
      [state.schema, resultField]
    );
    const resultValues = useMemo(
      () => (resultField ? { [resultField.path]: state.result } : NO_VALUES),
      [resultField, state.result]
    );
    const functionSelected = state.functionFqn !== null;
    const ready = functionSelected
      ? state.status === 'succeeded' && aggregateValidation.state === 'valid'
      : !!draft && standaloneValidation.state === 'valid';
    const payload = functionSelected ? state.result : draft?.values;
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
          inputs: Record<string, unknown>;
          sources: Record<string, string>;
          sourceIds: Record<string, string>;
        }
      | undefined
    >(undefined);
    const pendingSeed = useRef<Draft | undefined>(undefined);
    const selectFunction = useCallback(
      (option: TypeOption | null) => {
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
            setDraft({
              typeFqn: field.referencedTypeFqn,
              values: structuredClone(state.inputs[field.path]) as Record<string, unknown>,
              source: sources[field.path] ?? 'Workflow input',
              sourceId: sourceIds[field.path]
            });
          pendingSeed.current = undefined;
          previousInputs.current = undefined;
          void session.selectFunction(null);
          return;
        }
        previousInputs.current = state.schema
          ? { schema: state.schema, inputs: state.inputs, sources, sourceIds }
          : undefined;
        pendingSeed.current = draft;
        setSources({});
        setSourceIds({});
        void session.selectFunction(qualifiedNameFromNodeId(option.value), option.value);
      },
      [session, state, draft, sources, sourceIds, objectFields]
    );
    const lastModels = useRef(workspace?.models);
    useEffect(() => {
      if (lastModels.current === workspace?.models) return;
      lastModels.current = workspace?.models;
      if (state.functionFqn)
        selectFunction({
          value: state.schema?.targetId ?? state.functionFqn,
          label: state.schema?.title ?? state.functionFqn,
          kind: 'func'
        });
    }, [workspace?.models, selectFunction, state.functionFqn, state.schema]);
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
      if (!session || !state.schema) return;
      const previous = previousInputs.current;
      previousInputs.current = undefined;
      if (previous) {
        const fields = state.schema.fields.filter((field) =>
          previous.schema.fields.some(
            (old) => old.path === field.path && old.kind === field.kind && old.typeSymbol === field.typeSymbol
          )
        );
        if (fields.length) {
          session.setInputs({
            ...state.inputs,
            ...Object.fromEntries(fields.map((field) => [field.path, previous.inputs[field.path]]))
          });
          setSources(
            Object.fromEntries(fields.map((field) => [field.path, previous.sources[field.path] ?? 'Workflow input']))
          );
          setSourceIds(previous.sourceIds);
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
    }, [session, state.schema, workspace?.models]);
    const rootRef = useRef<HTMLElement>(null);
    const arrivalSchema = useMemo(
      () => ({ draftSchema, schema: state.schema, sourceIds }),
      [draftSchema, state.schema, sourceIds]
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
        setDraft({
          sourceId: candidate.id,
          typeFqn: candidate.typeFqn,
          values: structuredClone(candidate.data) as Record<string, unknown>,
          source: candidate.name
        });
      setBinding(undefined);
    };
    const setColumn = (index: number, value: number, commit = false) => {
      const next: [number, number] = [...widthRef.current];
      next[index] = Math.max(22, Math.min(40, value, 76 - next[1 - index]!));
      widthRef.current = next;
      setWidths(next);
      if (commit) patch({ workflowWidths: next });
    };
    const resultNode = (
      <div data-workflow-node="output">
        <WorkflowNode
          name={resultField?.path ?? 'output'}
          type={resultField ? workflowFieldType(resultField) : draft?.typeFqn.split('.').slice(-1)[0]}
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
                  Save as instance…
                </Button>
              ) : null}
            </>
          ) : (
            <p role="status" className="p-3 text-xs text-muted-foreground">
              {state.error ??
                (state.status === 'running'
                  ? 'Preparing function…'
                  : aggregateValidation.state === 'invalid'
                    ? 'Resolve input checks before executing.'
                    : functionSelected
                      ? 'Execute to generate an output.'
                      : draft
                        ? 'Resolve input validation to generate output.'
                        : 'Add or select an input object to begin.')}
            </p>
          )}
        </WorkflowNode>
      </div>
    );
    return (
      <section ref={rootRef} className="workflow" aria-label="Prototype workflow">
        {drag ? (
          <div className="workflow-drag-ghost" style={{ left: drag.x + 12, top: drag.y + 12 }}>
            {drag.label}
          </div>
        ) : null}
        <div className="workflow-toolbar">
          <span className="text-xs text-muted-foreground">Inputs → optional function → output</span>
          <div className="ml-auto flex gap-1">
            {(['panels', 'flow'] as const).map((v) => (
              <Button
                key={v}
                variant="ghost"
                size="xs"
                aria-pressed={mode === v}
                onClick={() => patch({ workflowView: v })}
              >
                {v === 'flow' ? 'Flow' : 'Panels'}
              </Button>
            ))}
          </div>
        </div>
        <div
          ref={stage}
          className={`workflow-stage workflow-stage--${mode}`}
          style={
            { '--workflow-input-width': `${widths[0]}%`, '--workflow-function-width': `${widths[1]}%` } as CSSProperties
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
                  key={field.path}
                  field={field}
                  schema={state.schema!}
                  state={state}
                  full={functionValidation}
                  onValidation={receiveInputValidation}
                  source={sources[field.path]}
                  sourceId={sourceIds[field.path]}
                  onChange={(values) => session?.setInputs(values)}
                  onBind={() => setBinding({ field })}
                />
              ))
            ) : draft ? (
              <WorkflowNode
                name="input"
                type={draft.typeFqn.split('.').slice(-1)[0]}
                schema={draftSchema}
                values={draft.values}
                onChange={(values) => setDraft({ ...draft, values, source: 'Workflow draft' })}
                source={draft.source}
                sourceId={draft.sourceId}
                validation={standaloneValidation}
                onBind={() => setBinding({})}
              >
                {!draftSchema ? (
                  <p role="status" className="p-3 text-xs">
                    {draftSchemaState?.error ?? 'Preparing input schema…'}
                  </p>
                ) : null}
              </WorkflowNode>
            ) : (
              <div className="workflow-empty">Add an object or choose a function.</div>
            )}
          </div>
          {[0, 1].map((index) => (
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
          <div className="workflow-function" data-workflow-node="function">
            <WorkflowNode
              name={state.schema?.title ?? 'Transform'}
              kind="function"
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
                    disabled={!session || state.status === 'running' || aggregateValidation.state !== 'valid'}
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
                        <TypeChip as="span" typeName={workflowFieldType(f)} typeKind={workflowFieldChipKind(f)} />
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No transform is required. Choose one compatible function to execute.
                  </p>
                )}
                {state.error ? (
                  <p role="alert" className="text-xs text-destructive">
                    {state.error}
                  </p>
                ) : null}
              </div>
            </WorkflowNode>
          </div>
          <div className="workflow-output">{resultNode}</div>
        </div>
        <Dialog open={!!binding} onOpenChange={(open) => !open && setBinding(undefined)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{binding?.record ? 'Use object as input' : 'Use stored object'}</DialogTitle>
              <DialogDescription>Choose an input binding. Stored data remains unchanged.</DialogDescription>
            </DialogHeader>
            <div className="studio-scroll max-h-80 overflow-auto space-y-1">
              {binding?.record ? (
                state.schema ? (
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
