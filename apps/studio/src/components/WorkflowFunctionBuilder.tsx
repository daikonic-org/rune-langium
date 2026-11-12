// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  renderWorkflowFunction,
  type WorkflowFunctionDefinition,
  type WorkflowFunctionParameter
} from '@rune-langium/codegen/rosetta';
import {
  CardinalityPicker,
  formatCardinality,
  parseCardinality,
  qualifiedNameFromNodeId,
  makeNodeId,
  useEditorStore
} from '@rune-langium/visual-editor';
import type { WorkflowDescriptor } from '@rune-langium/project-config';
import { Button } from '@rune-langium/design-system/ui/button';
import { Input } from '@rune-langium/design-system/ui/input';
import { Textarea } from '@rune-langium/design-system/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@rune-langium/design-system/ui/select';
import { Dialog, DialogContent } from '@rune-langium/design-system/ui/dialog';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { WorkspaceTypePicker } from './WorkspaceTypePicker.js';
import { useProject } from '../shell/providers/project-context.js';
import { useWorkspaceActionsOptional } from '../shell/perspectives/workspace-actions-context.js';
import { usePreviewSession } from '../shell/providers/preview-session-context.js';
import { saveWorkflowFunction } from '../workspace/workflow-repository.js';
import { generateUlid } from '../services/ulid.js';
import { withInstrumentation } from '../services/instrumentation/core.js';
import './workflow-function-builder.css';

interface StepDraft {
  id: string;
  name: string;
  mode: 'call' | 'expression';
  expression: string;
  callee: string | null;
  parameters: string[];
  arguments: string[];
  ready: boolean;
}
const parameter = (name: string): WorkflowFunctionParameter => ({
  name,
  type: 'number',
  cardinality: { min: 1, max: 1 }
});
const initialStep = (): StepDraft => ({
  id: generateUlid(),
  name: 'step1',
  mode: 'expression',
  expression: 'input',
  callee: null,
  parameters: [],
  arguments: [],
  ready: false
});
const stepExpression = (step: StepDraft) =>
  step.mode === 'call'
    ? `${step.callee ? qualifiedNameFromNodeId(step.callee) : ''}(${step.arguments.join(', ')})`
    : step.expression;

function ParameterRow({
  value,
  label,
  disabled,
  onChange,
  onRemove
}: {
  value: WorkflowFunctionParameter;
  label: string;
  disabled: boolean;
  onChange(value: WorkflowFunctionParameter): void;
  onRemove?(): void;
}) {
  const cardinality = value.cardinality;
  return (
    <div className="workflow-function-builder__parameter" role="group" aria-label={label}>
      <Input
        aria-label={`${label} name`}
        value={value.name}
        disabled={disabled}
        onChange={(e) => onChange({ ...value, name: e.target.value })}
      />
      <WorkspaceTypePicker
        label={`${label} type`}
        value={value.type}
        filterKinds={['builtin', 'data', 'choice', 'enum', 'record', 'typeAlias', 'basicType']}
        includeBuiltins
        disabled={disabled}
        onSelect={(type) => type && onChange({ ...value, type })}
      />
      <CardinalityPicker
        disabled={disabled}
        value={formatCardinality({
          inf: cardinality.min,
          sup: cardinality.max === 'unbounded' ? undefined : cardinality.max,
          unbounded: cardinality.max === 'unbounded'
        })}
        onChange={(text) => {
          const card = parseCardinality(text);
          onChange({
            ...value,
            cardinality: { min: card.inf, max: card.unbounded ? 'unbounded' : (card.sup ?? card.inf) }
          });
        }}
      />
      {onRemove ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={disabled}
          aria-label={`Remove ${label.toLowerCase()}`}
          onClick={onRemove}
        >
          <Trash2 className="size-3.5" />
        </Button>
      ) : (
        <span />
      )}
    </div>
  );
}

/** A call's argument names come from the same linked schema used by Prototype execution. */
function StepEditor({
  step,
  index,
  available,
  disabled,
  onChange,
  onRemove,
  onMove,
  count
}: {
  step: StepDraft;
  index: number;
  available: string[];
  disabled: boolean;
  count: number;
  onChange(step: StepDraft): void;
  onRemove(): void;
  onMove(delta: number): void;
}) {
  const client = usePreviewSession();
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const latest = useRef({ step, onChange, available });
  latest.current = { step, onChange, available };
  useEffect(() => {
    if (step.mode !== 'call' || !step.callee || !client) return;
    const abort = new AbortController();
    setError(undefined);
    latest.current.onChange({ ...latest.current.step, ready: false });
    void client
      .schema(step.callee, abort.signal)
      .then((schema) => {
        if (abort.signal.aborted) return;
        if (schema.kind !== 'function') throw new Error('This declaration is not a function. Choose another function.');
        const { step: current, onChange: change, available: names } = latest.current;
        const parameters = schema.fields.map((field) => field.path);
        change({
          ...current,
          parameters,
          ready: true,
          arguments: parameters.map((name) => {
            const previous = current.parameters.indexOf(name);
            return previous >= 0 ? (current.arguments[previous] ?? '') : names.includes(name) ? name : '';
          })
        });
      })
      .catch((failure: unknown) => {
        if (!abort.signal.aborted)
          setError(
            failure instanceof Error
              ? failure.message
              : 'Could not load the function signature. Choose it again to retry.'
          );
      });
    return () => abort.abort();
  }, [step.callee, step.mode, client, retry]);
  const label = `Step ${index + 1}`;
  return (
    <li className="workflow-function-builder__step" aria-label={label}>
      <div className="workflow-function-builder__step-heading">
        <span className="text-xs tabular-nums text-muted-foreground" aria-hidden="true">
          {index + 1}
        </span>
        <Input
          aria-label={`${label} name`}
          value={step.name}
          disabled={disabled}
          onChange={(e) => onChange({ ...step, name: e.target.value })}
        />
        <Select
          value={step.mode}
          onValueChange={(mode) => {
            if (mode === 'call' || mode === 'expression') onChange({ ...step, mode });
          }}
        >
          <SelectTrigger size="sm" disabled={disabled} aria-label={`${label} kind`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="call">Function call</SelectItem>
            <SelectItem value="expression">Rune expression</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={disabled || index === 0}
            aria-label={`Move ${label.toLowerCase()} up`}
            onClick={() => onMove(-1)}
          >
            <ArrowUp className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={disabled || index === count - 1}
            aria-label={`Move ${label.toLowerCase()} down`}
            onClick={() => onMove(1)}
          >
            <ArrowDown className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={disabled || count === 1}
            aria-label={`Remove ${label.toLowerCase()}`}
            onClick={onRemove}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>
      {step.mode === 'call' ? (
        <div className="grid gap-2">
          <WorkspaceTypePicker
            label={`${label} function`}
            value={step.callee}
            filterKinds={['func']}
            disabled={disabled}
            onSelect={() => {}}
            onSelectOption={(option) => {
              const callee = option?.value ?? null;
              if (callee !== step.callee) onChange({ ...step, callee, parameters: [], arguments: [], ready: false });
            }}
          />
          {step.callee && !step.ready && !error ? (
            <p role="status" className="text-xs text-muted-foreground">
              Loading arguments…
            </p>
          ) : null}
          {step.parameters.map((name, i) => (
            <label key={name} className="workflow-function-builder__argument">
              <span>{name}</span>
              <Input
                aria-label={`${label} argument ${name}`}
                disabled={disabled}
                list={`${step.id}-values`}
                placeholder="Input, earlier step or Rune expression"
                value={step.arguments[i] ?? ''}
                onChange={(e) =>
                  onChange({ ...step, arguments: step.arguments.map((value, j) => (j === i ? e.target.value : value)) })
                }
              />
            </label>
          ))}
          <datalist id={`${step.id}-values`}>
            {available.filter(Boolean).map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          {error ? (
            <div className="flex items-center gap-2">
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={disabled}
                onClick={() => setRetry((current) => current + 1)}
              >
                Retry arguments
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <Textarea
          aria-label={`${label} expression`}
          rows={3}
          spellCheck={false}
          className="workflow-function-builder__expression"
          value={step.expression}
          disabled={disabled}
          onChange={(e) => onChange({ ...step, expression: e.target.value })}
        />
      )}
      <p className="mt-1.5 text-xs text-muted-foreground">
        Available: {available.filter(Boolean).join(', ') || 'No inputs or earlier steps'}
      </p>
    </li>
  );
}

/** Authoring state only: executable composition is persisted as ordinary Rune source. */
export const WorkflowFunctionBuilder = withInstrumentation(
  function WorkflowFunctionBuilder({
    onClose,
    onCreated,
    embedded = false
  }: {
    embedded?: boolean;
    onClose(): void;
    onCreated(workflow: WorkflowDescriptor): void;
  }) {
    const project = useProject();
    const actions = useWorkspaceActionsOptional();
    const [namespace, setNamespace] = useState('local.compositions');
    const [name, setName] = useState('');
    const [inputs, setInputs] = useState<WorkflowFunctionParameter[]>([parameter('input')]);
    const [output, setOutput] = useState(parameter('result'));
    const [steps, setSteps] = useState<StepDraft[]>(() => [initialStep()]);
    const [result, setResult] = useState('step1');
    const [customPath, setCustomPath] = useState<string>();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string>();
    const attempt = useRef(0);
    useEffect(
      () => () => {
        ++attempt.current;
      },
      []
    );
    const path = customPath ?? `model/workflows/${namespace.replaceAll('.', '/')}/${name || 'Function'}.rosetta`;
    const definition: WorkflowFunctionDefinition = useMemo(
      () => ({
        composition: true,
        namespace,
        name,
        inputs,
        output,
        steps: steps.map((step) => ({ name: step.name, expression: stepExpression(step) })),
        result
      }),
      [namespace, name, inputs, output, steps, result]
    );
    const preview = useMemo(() => {
      try {
        if (
          steps.some(
            (step) => step.mode === 'call' && (!step.ready || step.arguments.some((argument) => !argument.trim()))
          )
        )
          throw new Error('Choose a function and bind each argument before creating the function.');
        return { source: renderWorkflowFunction(definition) };
      } catch (failure) {
        return { error: failure instanceof Error ? failure.message : 'Complete the function definition.' };
      }
    }, [definition, steps]);
    const create = async () => {
      if (!project.controller || busy || !preview.source) return;
      const version = ++attempt.current;
      setBusy(true);
      setError(undefined);
      try {
        await actions?.flushWorkspaceSave?.();
        if (attempt.current !== version) return;
        if (useEditorStore.getState().nodesById.has(makeNodeId(namespace, name, 'RosettaFunction')))
          throw new Error('A function with this name already exists. Choose another namespace or name.');
        const saved = await saveWorkflowFunction(project.controller, { definition, path, id: generateUlid() });
        if (attempt.current === version) onCreated(saved.workflow);
      } catch (failure) {
        if (attempt.current === version)
          setError(
            failure instanceof Error ? failure.message : 'Could not create the function. Your draft is retained.'
          );
      } finally {
        if (attempt.current === version) setBusy(false);
      }
    };
    const content = (
      <div className="workflow-function-builder__contents">
        <header className="workflow-function-builder__header">
          <h2 className="text-sm font-medium">New composition</h2>
          <p className="text-xs text-muted-foreground">Create a reusable Rune function, then open its canvas.</p>
        </header>
        <div className="workflow-function-builder__body">
          <div className="workflow-function-builder__form studio-scroll">
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1 text-xs">
                Namespace
                <Input
                  aria-label="Function namespace"
                  value={namespace}
                  disabled={busy}
                  onChange={(e) => setNamespace(e.target.value)}
                />
              </label>
              <label className="grid gap-1 text-xs">
                Function name
                <Input
                  aria-label="Function name"
                  value={name}
                  disabled={busy}
                  placeholder="CalculateCashflows"
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
            </div>
            <section aria-label="Function inputs" className="workflow-function-builder__section">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium">Inputs</h3>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    const used = new Set([
                      ...inputs.map((input) => input.name),
                      ...steps.map((step) => step.name),
                      output.name
                    ]);
                    let n = inputs.length + 1;
                    while (used.has(`input${n}`)) n++;
                    setInputs([...inputs, parameter(`input${n}`)]);
                  }}
                >
                  <Plus className="size-3.5" />
                  Add input
                </Button>
              </div>
              {inputs.length ? (
                inputs.map((input, i) => (
                  <ParameterRow
                    key={i}
                    value={input}
                    label={`Input ${i + 1}`}
                    disabled={busy}
                    onChange={(value) => setInputs(inputs.map((existing, j) => (j === i ? value : existing)))}
                    onRemove={() => setInputs(inputs.filter((_, j) => j !== i))}
                  />
                ))
              ) : (
                <p className="text-xs text-muted-foreground">This function has no inputs.</p>
              )}
            </section>
            <section aria-label="Function steps" className="workflow-function-builder__section">
              <div>
                <h3 className="text-sm font-medium">Steps</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Call a function, or use a Rune expression to select, map or filter values.
                </p>
              </div>
              <ol className="grid gap-0">
                {steps.map((step, i) => (
                  <StepEditor
                    key={step.id}
                    step={step}
                    index={i}
                    count={steps.length}
                    disabled={busy}
                    available={[
                      ...inputs.map((input) => input.name),
                      ...steps.slice(0, i).map((previous) => previous.name)
                    ]}
                    onChange={(value) => {
                      if (value.name !== step.name)
                        setResult((current) => (current === step.name ? value.name : current));
                      setSteps((current) => current.map((existing) => (existing.id === value.id ? value : existing)));
                    }}
                    onMove={(delta) =>
                      setSteps((current) => {
                        const next = [...current];
                        [next[i], next[i + delta]] = [next[i + delta]!, next[i]!];
                        return next;
                      })
                    }
                    onRemove={() => {
                      setSteps(steps.filter((_, j) => j !== i));
                      if (result === step.name) setResult(steps[i - 1]?.name ?? inputs[0]?.name ?? '');
                    }}
                  />
                ))}
              </ol>
              <Button
                type="button"
                size="xs"
                variant="outline"
                className="justify-self-start"
                disabled={busy}
                onClick={() => {
                  let n = steps.length + 1;
                  while (steps.some((step) => step.name === `step${n}`)) n++;
                  const next = {
                    ...initialStep(),
                    name: `step${n}`,
                    expression: steps.at(-1)?.name ?? inputs[0]?.name ?? ''
                  };
                  setSteps([...steps, next]);
                  setResult(next.name);
                }}
              >
                <Plus className="size-3.5" />
                Add step
              </Button>
            </section>
            <section aria-label="Function output" className="workflow-function-builder__section">
              <h3 className="text-sm font-medium">Output</h3>
              <ParameterRow value={output} label="Output" disabled={busy} onChange={setOutput} />
              <label className="grid gap-1 text-xs">
                Output expression
                <Input
                  aria-label="Output expression"
                  value={result}
                  disabled={busy}
                  onChange={(e) => setResult(e.target.value)}
                />
              </label>
            </section>
            <details className="workflow-function-builder__destination">
              <summary>Source file</summary>
              <Input
                className="mt-2"
                aria-label="Function source path"
                value={path}
                disabled={busy}
                onChange={(e) => setCustomPath(e.target.value)}
              />
            </details>
          </div>
          <section className="workflow-function-builder__preview" aria-label="Rune source preview">
            <h3 className="border-b border-border px-3 py-2 text-xs font-medium">Rune source</h3>
            {preview.source ? (
              <pre className="studio-scroll flex-1 overflow-auto p-3 text-xs">
                <code>{preview.source}</code>
              </pre>
            ) : (
              <p className="p-3 text-xs text-muted-foreground" role="status">
                {name ? preview.error : 'Name the function to preview its source.'}
              </p>
            )}
            <p className="border-t border-border p-3 text-xs text-muted-foreground">
              Creates an editable source file. Prototype checks the function before execution.
            </p>
          </section>
        </div>
        <div className="workflow-function-builder__footer">
          {error ? (
            <p role="alert" className="mr-auto text-xs text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy || !preview.source || !project.controller}
            onClick={() => void create()}
          >
            {busy ? 'Creating function…' : 'Create function'}
          </Button>
        </div>
      </div>
    );
    return embedded ? (
      <section aria-label="New composition" className="workflow-function-builder workflow-function-builder--embedded">
        {content}
      </section>
    ) : (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open && !busy) onClose();
        }}
      >
        <DialogContent className="workflow-function-builder" aria-label="New composition">
          {content}
        </DialogContent>
      </Dialog>
    );
  },
  {
    op: 'WorkflowFunctionBuilder',
    capture: 0,
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);
