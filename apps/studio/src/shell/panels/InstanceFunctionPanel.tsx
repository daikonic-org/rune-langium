// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactElement } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@rune-langium/design-system/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@rune-langium/design-system/ui/select';
import { Button } from '@rune-langium/design-system/ui/button';
import { WorkspaceTypePicker } from '../../components/WorkspaceTypePicker.js';
import { FormPreviewPanel } from '../../components/FormPreviewPanel.js';
import { useInstanceStore } from '../../store/instance-store.js';
import { usePreviewSessionFactory } from '../providers/preview-session-context.js';
import {
  createFunctionSession,
  type FunctionSession,
  type FunctionSessionState
} from '../../store/function-session-store.js';
import { withInstrumentation } from '../../services/instrumentation/core.js';
import { resolveFunctionOutputTarget } from '../../services/function-output-target.js';
import { isInstanceBindableToField } from '../../services/function-input-binding.js';
import { requestPrototype } from '../../services/prototype-navigation.js';
import { useWorkspaceOptional } from '../providers/workspace-context.js';
import { qualifiedNameFromNodeId } from '@rune-langium/visual-editor';

const NO_SESSION_STATE: FunctionSessionState = {
  functionFqn: null,
  boundParameter: null,
  inputs: {},
  result: undefined,
  status: 'idle'
};

function InstanceFunctionSession({
  instanceId,
  onStateChange
}: {
  instanceId: string;
  onStateChange?(state: FunctionSessionState | undefined): void;
}): ReactElement {
  const workspace = useWorkspaceOptional();
  const workspaceId = workspace?.workspaceId;
  const factory = usePreviewSessionFactory();
  const instance = useInstanceStore((state) => state.instances[instanceId]);
  const [session, setSession] = useState<FunctionSession>();
  useEffect(() => {
    if (!factory) {
      setSession(undefined);
      return;
    }
    // A session owns worker listeners. Create and dispose them together so
    // StrictMode's setup/cleanup replay cannot retain a disposed client.
    const next = createFunctionSession(factory());
    setSession(next);
    return () => next.dispose();
  }, [factory]);
  const state = useSyncExternalStore(
    (listener) => session?.subscribe(listener) ?? (() => undefined),
    () => session?.getState() ?? NO_SESSION_STATE
  );
  useEffect(() => {
    onStateChange?.(state);
  }, [onStateChange, state]);
  useEffect(() => () => onStateChange?.(undefined), [onStateChange]);
  const outputTarget = useMemo(
    () => resolveFunctionOutputTarget(workspace?.models ?? [], state.functionFqn, state.schema),
    [state.functionFqn, state.schema, workspace?.models]
  );
  const canSaveResult =
    state.status === 'succeeded' &&
    outputTarget !== undefined &&
    state.result !== null &&
    typeof state.result === 'object' &&
    !Array.isArray(state.result);
  const [parametersOpen, setParametersOpen] = useState(false);
  const bindableFields = useMemo(
    () =>
      instance
        ? (state.schema?.fields.filter((field) =>
            isInstanceBindableToField(instance, field, workspace?.models ?? [])
          ) ?? [])
        : [],
    [instance?.typeFqn, state.schema, workspace?.models]
  );
  const parameter =
    bindableFields.find((field) => field.path === state.boundParameter) ??
    (bindableFields.length === 1 ? bindableFields[0] : undefined);
  const lastBinding = useRef<
    { session: FunctionSession; schema: typeof state.schema; parameter: string; data: unknown } | undefined
  >(undefined);
  useEffect(() => {
    if (!session || !instance || !parameter) return;
    const previous = lastBinding.current;
    if (
      previous &&
      previous.session === session &&
      previous.schema === state.schema &&
      previous.parameter === parameter.path &&
      previous.data === instance.data
    )
      return;
    lastBinding.current = { session, schema: state.schema, parameter: parameter.path, data: instance.data };
    // Rebinding uses the same invalidation path as editing parameters: an old
    // in-flight result can never replace the result for newer instance data.
    session.bindInstance(parameter.path, instance);
  }, [session, instance?.data, parameter?.path, state.schema]);
  const extraSchema = useMemo(
    () =>
      state.schema
        ? {
            ...state.schema,
            fields: state.schema.fields.filter((field) => field.path !== parameter?.path)
          }
        : undefined,
    [state.schema, parameter?.path]
  );
  const needsBinding = !!state.schema?.fields.length && !parameter;
  const hasExtraParameters = !!extraSchema?.fields.length && !needsBinding;
  if (!factory || !session)
    return (
      <section className="space-y-2 p-3">
        <h3 className="font-semibold">Functions</h3>
        <p className="text-sm text-muted-foreground">Function execution is preparing…</p>
      </section>
    );
  return (
    <section className="space-y-3 p-3" aria-label="Function session">
      <h3 className="font-semibold">Functions</h3>
      <WorkspaceTypePicker
        label="Choose a function"
        value={state.functionFqn}
        onSelect={() => undefined}
        onSelectOption={(option) => {
          if (!option) return;
          setParametersOpen(false);
          void session.selectFunction(qualifiedNameFromNodeId(option.value), option.value);
        }}
        filterKinds={['func']}
      />
      {!state.functionFqn ? (
        <p className="text-xs text-muted-foreground">Apply a function to this instance’s data.</p>
      ) : null}
      {state.status === 'running' && !state.schema ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading function…
        </p>
      ) : null}
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      {state.schema ? (
        <>
          {bindableFields.length > 1 ? (
            <Select
              value={state.boundParameter}
              onValueChange={(path) => instance && session.bindInstance(path, instance)}
            >
              <SelectTrigger aria-label="Instance parameter">
                <SelectValue placeholder="Use data for…" />
              </SelectTrigger>
              <SelectContent>
                {bindableFields.map((field) => (
                  <SelectItem key={field.path} value={field.path}>
                    {field.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          {parameter && instance ? (
            <p className="text-xs text-muted-foreground">
              Using {instance.name} as {parameter.label}.
            </p>
          ) : null}
          {needsBinding ? (
            <p className="text-xs text-muted-foreground">
              {bindableFields.length
                ? 'Choose which parameter receives this instance.'
                : 'This function has no parameter that accepts this instance’s type.'}
            </p>
          ) : null}
          <Collapsible open={parametersOpen} onOpenChange={setParametersOpen}>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                disabled={state.status === 'running' || needsBinding}
                onClick={() => {
                  if (parameter && instance) session.bindInstance(parameter.path, instance);
                  void session.run();
                }}
              >
                {state.status === 'running' ? 'Applying…' : 'Apply'}
              </Button>
              {hasExtraParameters ? (
                <CollapsibleTrigger
                  render={<Button type="button" variant="ghost" size="sm" aria-label="Additional parameters" />}
                >
                  <MoreHorizontal className="size-4" aria-hidden="true" />
                </CollapsibleTrigger>
              ) : null}
            </div>
            {hasExtraParameters ? (
              <>
                <p className="mt-2 text-xs text-muted-foreground">
                  {extraSchema?.fields.length} additional{' '}
                  {extraSchema?.fields.length === 1 ? 'parameter' : 'parameters'}
                </p>
                <CollapsibleContent>
                  <div className="mt-3 border-t border-border pt-3" role="region" aria-label="Additional parameters">
                    <FormPreviewPanel
                      ariaLabel="Function parameters"
                      schema={extraSchema}
                      status={{ state: 'ready', targetId: state.schema.targetId }}
                      values={state.inputs}
                      onValuesChange={(inputs) => session.setInputs(inputs)}
                      presentation={{
                        mode: 'instance',
                        showHeader: false,
                        showPayload: false,
                        showLayoutToolbar: false,
                        showExecutionControls: false
                      }}
                    />
                  </div>
                </CollapsibleContent>
              </>
            ) : null}
          </Collapsible>
        </>
      ) : null}
      {state.status === 'succeeded' ? (
        <>
          {canSaveResult && workspaceId ? (
            <Button
              type="button"
              size="sm"
              onClick={() =>
                requestPrototype(workspaceId, {
                  kind: 'create',
                  seed: { typeFqn: outputTarget.typeFqn, data: structuredClone(state.result) }
                })
              }
            >
              Save result as instance…
            </Button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

export const InstanceFunctionPanel = withInstrumentation(
  function InstanceFunctionPanel({
    instanceId,
    onStateChange
  }: {
    instanceId: string;
    onStateChange?(state: FunctionSessionState | undefined): void;
  }): ReactElement {
    return <InstanceFunctionSession key={instanceId} instanceId={instanceId} onStateChange={onStateChange} />;
  },
  { op: 'InstanceFunctionPanel' }
);
