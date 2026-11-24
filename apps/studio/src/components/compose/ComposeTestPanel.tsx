// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Daikonic contributors

import { useMemo, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { Button } from '@rune-langium/design-system/ui/button';
import { NativeSelect } from '@rune-langium/design-system/ui/select';
import { readWorkflows } from '@rune-langium/project-config';
import { makeNodeId, useLatestRef } from '@rune-langium/visual-editor';
import { FormPreviewPanel } from '../../shell/panels/FormPreviewPanel.js';
import { useProject } from '../../shell/providers/project-context.js';
import { useWorkspaceOptional } from '../../shell/providers/workspace-context.js';
import { useComposeNavigationStore } from '../../store/compose-navigation-store.js';
import { exampleInputValue } from '../../store/function-session-store.js';
import { useInstanceStore } from '../../store/instance-store.js';
import { usePerspectiveStore } from '../../store/perspective-store.js';
import { usePreviewStore } from '../../store/preview-store.js';
import { buildDefaultValues, resolveArmPaths } from '../../services/preview-validator.js';
import { resolveExampleType } from '../../workspace/example-identity.js';
import { captureWorkflowRecipe, resolveWorkflowInputs } from '../../workspace/workflow-repository.js';
import { withInstrumentation } from '../../services/instrumentation/core.js';

export const ComposeTestPanel = withInstrumentation(
  function ComposeTestPanel({
    functionId,
    onSave,
    prototypeDisabled
  }: {
    functionId: string;
    onSave(): Promise<boolean>;
    prototypeDisabled: boolean;
  }) {
    const { snapshot, workspaceId } = useProject();
    const workspace = useWorkspaceOptional();
    const [workflowId, setWorkflowId] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string>();
    const schema = usePreviewStore((state) => state.schemas.get(functionId));
    const workflows = useMemo(
      () =>
        snapshot
          ? readWorkflows(snapshot)
              .workflows.filter(({ function: fn }) => fn && makeNodeId(fn.namespace, fn.name, fn.kind) === functionId)
              .sort((a, b) => a.name.localeCompare(b.name))
          : [],
      [snapshot, functionId]
    );
    const workflow = workflows.find(({ id }) => id === workflowId) ?? workflows[0];
    const current = useLatestRef({ functionId, workflow, workspaceId });
    const functionIdentity = workspace && resolveExampleType(workspace, { typeFqn: functionId }, 'RosettaFunction');

    const loadWorkflowInputs = async () => {
      if (!workflow || !schema) return;
      setError(undefined);
      setBusy(true);
      try {
        const epoch = useInstanceStore.getState().workspaceEpoch;
        const previousValues = usePreviewStore.getState().samples.get(functionId)?.values;
        await useInstanceStore.getState().loadInstancesFromOpfs();
        const instances = useInstanceStore.getState();
        const preview = usePreviewStore.getState();
        const currentSchema = preview.schemas.get(functionId);
        if (
          epoch !== instances.workspaceEpoch ||
          preview.selectedTargetId !== functionId ||
          current.current.functionId !== functionId ||
          current.current.workflow?.id !== workflow.id ||
          current.current.workspaceId !== workspaceId ||
          !currentSchema
        )
          return;
        if (previousValues !== preview.samples.get(functionId)?.values)
          throw new Error('The test inputs changed while loading. Use workflow inputs again to replace them.');
        const { values, bindings } = resolveWorkflowInputs(workflow, instances.instances);
        const boundValues = Object.fromEntries(
          bindings.map(([path]) => [path, exampleInputValue(currentSchema, path, values[path])])
        );
        preview.resetSample(functionId, {
          ...buildDefaultValues(currentSchema.fields, resolveArmPaths(currentSchema)),
          ...values,
          ...boundValues
        });
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : 'Could not load workflow inputs.');
      } finally {
        setBusy(false);
      }
    };

    const openPrototype = async () => {
      const workspaceEpoch = useInstanceStore.getState().workspaceEpoch;
      if (!workspaceId || !(await onSave())) return;
      const latest = current.current;
      const perspective = usePerspectiveStore.getState();
      if (
        workspaceEpoch !== useInstanceStore.getState().workspaceEpoch ||
        perspective.activePerspective !== 'compose' ||
        usePreviewStore.getState().selectedTargetId !== functionId ||
        latest.workspaceId !== workspaceId ||
        latest.functionId !== functionId ||
        latest.workflow?.id !== workflow?.id
      )
        return;
      const recipe =
        latest.workflow ??
        (functionIdentity &&
          captureWorkflowRecipe({
            id: crypto.randomUUID(),
            name: functionIdentity.name,
            function: functionIdentity,
            inputs: {},
            records: {},
            outputs: {}
          }));
      if (recipe) {
        useComposeNavigationStore.getState().requestRecipe(workspaceId, recipe);
        perspective.setActivePerspective('prototype');
      }
    };

    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-inspector-x py-panel-y">
          {workflows.length > 1 ? (
            <NativeSelect
              aria-label="Test workflow"
              className="w-full"
              value={workflow?.id}
              onChange={(event) => {
                setWorkflowId(event.currentTarget.value);
                setError(undefined);
              }}
            >
              {workflows.map(({ id, name }) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </NativeSelect>
          ) : (
            <p className="w-full text-xs text-caption">
              {workflow?.name ?? 'Save a workflow in Prototype to reuse its inputs here.'}
            </p>
          )}
          {workflow && (
            <Button size="xs" variant="outline" onClick={() => void loadWorkflowInputs()} disabled={busy || !schema}>
              {busy ? 'Loading inputs…' : 'Use workflow inputs'}
            </Button>
          )}
          <Button
            size="xs"
            variant="ghost"
            onClick={() => void openPrototype()}
            disabled={prototypeDisabled || !workspaceId || !(workflow || functionIdentity)}
          >
            Open in Prototype <ArrowUpRight aria-hidden="true" />
          </Button>
          {error && (
            <p role="alert" className="w-full text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
        <div className="min-h-0 flex-1">
          <FormPreviewPanel executionDisabled={busy} />
        </div>
      </div>
    );
  },
  { op: 'ComposeTestPanel', capture: 0 }
);
