// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactElement } from 'react';
import type { DockviewApi } from 'dockview-react';
import type { WorkbenchDefinition } from '../../workbench-types.js';
import { WorkbenchHost } from '../../WorkbenchHost.js';
import { Button } from '@rune-langium/design-system/ui/button';
import { jsonCodec } from '@rune-langium/codegen/instances';
import { InstanceCreateDialog } from '../../../components/InstanceCreateDialog.js';
import { usePrototypeViewStore } from '../../../store/prototype-view-store.js';
import { useWorkspaceOptional } from '../../providers/workspace-context.js';
import { InstanceInspectorPanel } from '../../panels/InstanceInspectorPanel.js';
import { InstanceGridPanel } from '../../panels/InstanceGridPanel.js';
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
    const [importError, setImportError] = useState<string | null>(null);
    const [payloadFocus, setPayloadFocus] = useState<{ pointer: string; revision: number }>();
    const [activationReady, setActivationReady] = useState(false);
    const importInputRef = useRef<HTMLInputElement>(null);
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
          'prototype.inspector': () =>
            view.selectedId ? (
              <InstanceInspectorPanel
                onNewInstance={beginCreate}
                instanceId={view.selectedId}
                focusedPayloadPointer={payloadFocus?.pointer}
                focusRequestId={payloadFocus?.revision}
              />
            ) : (
              <div className="flex h-full items-center justify-center p-3 text-sm text-muted-foreground">
                Select or create an instance to inspect it.
              </div>
            ),
          'prototype.grid': () => <InstanceGridPanel />,
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
                      Select an instance to inspect its payload graph.
                    </div>
                  )
              }
            : {})
        },
        titles: {
          'prototype.inspector': 'Inspector',
          'prototype.grid': 'Instances',
          ...(view.graphVisible ? { 'prototype.payloadGraph': 'Payload graph' } : {})
        },
        buildDefault(api, width) {
          const inspector = api.addPanel({
            id: 'prototype.inspector',
            component: 'prototype.inspector',
            title: 'Inspector'
          });
          if (view.graphVisible) addPayloadGraph(api, width);
          api.addPanel({
            id: 'prototype.grid',
            component: 'prototype.grid',
            title: 'Instances',
            position:
              width < 768
                ? { referenceGroup: inspector.group, direction: 'within' }
                : { referencePanel: inspector.id, direction: 'below' }
          });
        },
        reconcile(api, width) {
          if (view.graphVisible) addPayloadGraph(api, width);
        }
      }),
      [beginCreate, payloadFocus, selectedRecord, view.graphVisible, view.selectedId]
    );

    const importJson = async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      const result = jsonCodec.import(await file.text(), view.typeFqn ?? '');
      if (result.diagnostics.length > 0 || result.data === undefined) {
        setImportError(result.diagnostics.map((diagnostic) => diagnostic.message).join(' '));
        return;
      }
      setImportError(null);
      setSeed({ data: result.data, ...(view.typeFqn ? { typeFqn: view.typeFqn } : {}) });
      setCreating(true);
    };

    return (
      <section data-testid="prototype-perspective" className="flex h-full min-h-0 flex-col">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
          <p className="text-sm text-muted-foreground">Persistent instances</p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              aria-label="Import JSON"
              className="sr-only"
              onChange={importJson}
            />
            <Button type="button" variant="ghost" size="sm" onClick={() => importInputRef.current?.click()}>
              Import JSON
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-pressed={view.graphVisible}
              onClick={() => patch({ graphVisible: !view.graphVisible })}
            >
              Payload graph
            </Button>
            <Button type="button" size="sm" onClick={beginCreate}>
              New instance
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1">
          {activationReady ? (
            <WorkbenchHost
              key={view.graphVisible ? 'with-payload-graph' : 'without-payload-graph'}
              definition={definition}
              initialNativeLayout={view.nativeLayout}
              onNativeLayoutChange={(nativeLayout) => patch({ nativeLayout })}
              className="h-full min-w-0 w-full"
            />
          ) : (
            <p role="status" className="p-3 text-sm text-muted-foreground">
              Restoring Prototype workspace…
            </p>
          )}
        </div>
        {importError ? (
          <p role="alert" className="border-t border-border p-2 text-sm text-destructive">
            {importError}
          </p>
        ) : null}
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
