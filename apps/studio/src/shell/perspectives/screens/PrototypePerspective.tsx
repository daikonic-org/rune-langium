// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactElement } from 'react';
import type { DockviewApi, IDockviewHeaderActionsProps } from 'dockview-react';
import type { WorkbenchDefinition } from '../../workbench-types.js';
import { WorkbenchHost } from '../../WorkbenchHost.js';
import { Button } from '@rune-langium/design-system/ui/button';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { InstanceCreateDialog } from '../../../components/InstanceCreateDialog.js';
import { usePrototypeViewStore } from '../../../store/prototype-view-store.js';
import { useWorkspaceOptional } from '../../providers/workspace-context.js';
import { InstanceInspectorPanel } from '../../panels/InstanceInspectorPanel.js';
import { InstanceGridPanel } from '../../panels/InstanceGridPanel.js';
import { WorkflowListPanel } from '../../panels/WorkflowListPanel.js';
import { InstanceGraphPanel } from '../../panels/InstanceGraphPanel.js';
import { useInstanceStore } from '../../../store/instance-store.js';
import { withInstrumentation } from '../../../services/instrumentation/core.js';
import { usePrototypeNavigationStore } from '../../../services/prototype-navigation.js';

function addPayloadGraph(api: DockviewApi, width: number): void {
  if (api.getPanel('prototype.payloadGraph')) return;
  const inspector = api.getPanel('prototype.inspector');
  if (!inspector) return;
  const graph = api.addPanel({
    id: 'prototype.payloadGraph',
    component: 'prototype.payloadGraph',
    title: 'Payload graph',
    position:
      width < 768
        ? { referenceGroup: inspector.group, direction: 'within' }
        : { referencePanel: inspector.id, direction: 'right' }
  });
  if (width >= 768) graph.group.api.setConstraints({ minimumWidth: 280 });
}

function addWorkflowList(api: DockviewApi): void {
  const grid = api.getPanel('prototype.grid');
  if (!grid || api.getPanel('prototype.workflows')) return;
  api.addPanel({
    id: 'prototype.workflows',
    component: 'prototype.workflows',
    title: 'Workflows',
    inactive: true,
    position: { referenceGroup: grid.group, direction: 'within' }
  });
}

function addExampleLibraryEdge(api: DockviewApi, height = 190) {
  const edge = api.addEdgeGroup('bottom', {
    id: 'prototype.library',
    initialSize: height,
    minimumSize: 120,
    collapsedSize: 34,
    collapsed: false
  });
  edge.setHeaderPosition('top');
  return edge;
}

function dockExampleLibrary(api: DockviewApi): void {
  const grid = api.getPanel('prototype.grid');
  if (!grid || grid.api.location.type !== 'grid' || api.getEdgeGroup('bottom')) return;
  const { group } = grid;
  if (group.panels.some((panel) => panel.id !== 'prototype.grid' && panel.id !== 'prototype.workflows')) return;

  // Upgrade a full-width bottom split. Leave custom side, floating and shared groups in place.
  const { grid: layout } = api.toJSON();
  let { root } = layout;
  let vertical = layout.orientation === 'VERTICAL';
  while (
    root.type === 'branch' &&
    Array.isArray(root.data) &&
    root.data.length === 1 &&
    root.data[0]?.type === 'branch'
  ) {
    root = root.data[0];
    vertical = !vertical;
  }
  const last = Array.isArray(root.data) ? root.data.at(-1) : undefined;
  if (!vertical || last?.type !== 'leaf' || Array.isArray(last.data) || last.data.id !== group.id) return;
  const active = api.activePanel;
  const selected = group.activePanel;
  const edge = addExampleLibraryEdge(api, Math.max(120, group.api.height || 190));
  const target = api.groups.find((candidate) => candidate.id === edge.id);
  if (!target) return;
  const panels = group.panels.slice();
  for (const panel of panels) panel.api.moveTo({ group: target, position: 'center', skipSetActive: true });
  selected?.api.setActive();
  active?.api.setActive();
}

function ExampleLibraryHeader({ group }: IDockviewHeaderActionsProps): ReactElement | null {
  const subscribe = useCallback(
    (update: () => void) => {
      const listener = group.api.onDidCollapsedChange(update);
      return () => listener.dispose();
    },
    [group]
  );
  const collapsed = useSyncExternalStore(subscribe, () => group.api.isCollapsed());
  const location = group.api.location;
  if (
    location.type !== 'edge' ||
    location.position !== 'bottom' ||
    !group.panels.length ||
    group.panels.some((panel) => panel.id !== 'prototype.grid' && panel.id !== 'prototype.workflows')
  )
    return null;
  const label = collapsed ? 'Expand example library' : 'Collapse example library';
  const Icon = collapsed ? ChevronUp : ChevronDown;
  return (
    <Button
      type="button"
      size="icon-xs"
      variant="ghost"
      aria-label={label}
      aria-expanded={!collapsed}
      title={label}
      onClick={() => (collapsed ? group.api.expand() : group.api.collapse())}
    >
      <Icon className="size-3.5" aria-hidden="true" />
    </Button>
  );
}

export const PrototypePerspective = withInstrumentation(
  function PrototypePerspective(): ReactElement {
    const workspace = useWorkspaceOptional();
    const view = usePrototypeViewStore((state) => state.state);
    const activate = usePrototypeViewStore((state) => state.activate);
    const patch = usePrototypeViewStore((state) => state.patch);
    const pendingIntent = usePrototypeNavigationStore((state) => state.pending);
    const consumePrototypeIntent = usePrototypeNavigationStore((state) => state.consume);
    const [creating, setCreating] = useState(false);
    const [seed, setSeed] = useState<Parameters<typeof InstanceCreateDialog>[0]['seed']>();
    const beginCreate = useCallback(() => {
      setSeed(undefined);
      setCreating(true);
    }, []);
    const [payloadFocus, setPayloadFocus] = useState<{ pointer: string; revision: number }>();
    const [activationReady, setActivationReady] = useState(false);
    const [requestedWorkflow, setRequestedWorkflow] = useState<{ id: string }>();
    const dock = useRef<DockviewApi | undefined>(undefined);
    const openWorkflow = useCallback(
      (id: string) => {
        patch({ workflowView: 'flow' });
        dock.current?.getPanel('prototype.inspector')?.api.setActive();
        setRequestedWorkflow({ id });
      },
      [patch]
    );
    const activationRef = useRef<{ workspaceId: string; promise: Promise<void> } | undefined>(undefined);
    const selectedRecord = useInstanceStore((state) =>
      view.selectedId ? state.instances[view.selectedId] : undefined
    );

    useEffect(() => {
      const workspaceId = workspace?.workspaceId;
      if (!workspaceId) {
        setActivationReady(false);
        return;
      }
      if (activationRef.current?.workspaceId !== workspaceId) {
        setActivationReady(false);
        activationRef.current = { workspaceId, promise: activate(workspaceId) };
      }
      let cancelled = false;
      void activationRef.current.promise.then(() => {
        if (cancelled) return;
        const intent = consumePrototypeIntent(workspaceId);
        if (intent?.kind === 'create') {
          setSeed(intent.seed);
          setCreating(true);
        }
        if (intent?.kind === 'open') patch({ selectedId: intent.instanceId });
        setActivationReady(true);
      });
      return () => {
        cancelled = true;
      };
    }, [activate, consumePrototypeIntent, patch, pendingIntent, workspace?.workspaceId]);
    useEffect(() => setPayloadFocus(undefined), [selectedRecord?.id]);

    const definition = useMemo<WorkbenchDefinition>(
      () => ({
        id: 'prototype',
        panels: {
          'prototype.inspector': () => (
            <InstanceInspectorPanel
              key={workspace?.workspaceId}
              instanceId={view.selectedId ?? undefined}
              bindingRequestId={view.bindingRequestId}
              requestedWorkflow={requestedWorkflow}
              focusedPayloadPointer={payloadFocus?.pointer}
              focusRequestId={payloadFocus?.revision}
            />
          ),
          'prototype.grid': () => <InstanceGridPanel />,
          'prototype.workflows': () => <WorkflowListPanel onOpen={openWorkflow} />,
          ...(view.graphVisible
            ? {
                'prototype.payloadGraph': () =>
                  selectedRecord ? (
                    <InstanceGraphPanel
                      record={selectedRecord}
                      onSelectPointer={(pointer) =>
                        setPayloadFocus((previous) => ({ pointer, revision: (previous?.revision ?? 0) + 1 }))
                      }
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center p-3 text-sm text-muted-foreground">
                      Select an example to inspect its payload graph.
                    </div>
                  )
              }
            : {})
        },
        titles: {
          'prototype.inspector': 'Workflow',
          'prototype.grid': 'Data',
          'prototype.workflows': 'Workflows',
          ...(view.graphVisible ? { 'prototype.payloadGraph': 'Payload graph' } : {})
        },
        buildDefault(api, width) {
          const inspector = api.addPanel({
            id: 'prototype.inspector',
            component: 'prototype.inspector',
            title: 'Workflow',
            renderer: 'always'
          });
          if (view.graphVisible) addPayloadGraph(api, width);
          const library = width < 768 ? inspector.group.id : addExampleLibraryEdge(api).id;
          api.addPanel({
            id: 'prototype.grid',
            component: 'prototype.grid',
            title: 'Data',
            position: { referenceGroup: library, direction: 'within' }
          });
          addWorkflowList(api);
          inspector.api.setActive();
        },
        reconcile(api, width) {
          const grid = api.getPanel('prototype.grid');
          if (grid?.api.title === 'Examples') grid.api.setTitle('Data');
          addWorkflowList(api);
          if (width >= 768) dockExampleLibrary(api);
          if (view.graphVisible) addPayloadGraph(api, width);
          else {
            const graph = api.getPanel('prototype.payloadGraph');
            if (graph) api.removePanel(graph);
          }
        }
      }),
      [
        beginCreate,
        openWorkflow,
        requestedWorkflow,
        payloadFocus,
        selectedRecord,
        view.graphVisible,
        view.selectedId,
        view.bindingRequestId,
        workspace?.workspaceId
      ]
    );

    return (
      <section data-testid="prototype-perspective" className="flex h-full min-h-0 flex-col">
        <div className="workflow-toolbar">
          <div role="group" aria-label="Prototype view" className="flex gap-1">
            {(['flow', 'panels'] as const).map((mode) => (
              <Button
                key={mode}
                variant="ghost"
                size="xs"
                aria-pressed={(view.workflowView ?? 'flow') === mode}
                onClick={() => patch({ workflowView: mode })}
              >
                {mode === 'flow' ? 'Workflow' : 'Object builder'}
              </Button>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              aria-pressed={view.graphVisible}
              onClick={() => patch({ graphVisible: !view.graphVisible })}
            >
              Payload graph
            </Button>
            <Button type="button" size="xs" onClick={beginCreate}>
              Add
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1">
          {activationReady ? (
            <WorkbenchHost
              definition={definition}
              rightHeaderActionsComponent={ExampleLibraryHeader}
              initialNativeLayout={view.nativeLayout}
              onReady={(api) => {
                dock.current = api;
              }}
              onNativeLayoutChange={(nativeLayout) => patch({ nativeLayout })}
              className="h-full min-w-0 w-full"
            />
          ) : (
            <p role="status" className="p-3 text-sm text-muted-foreground">
              Restoring Prototype workspace…
            </p>
          )}
        </div>
        <InstanceCreateDialog
          seed={seed}
          open={creating}
          onClose={() => setCreating(false)}
          onCreated={(id) => patch({ selectedId: id })}
        />
      </section>
    );
  },
  { op: 'PrototypePerspective' }
);
