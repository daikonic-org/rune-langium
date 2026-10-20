// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { useEffect, useMemo, useRef, useState } from 'react';
import { emphasizeNavigationArrival } from '../../utils/navigation-arrival.js';
import type { PayloadView } from '../../components/FormPreviewPanel.js';
import type { FunctionSessionState } from '../../store/function-session-store.js';
import { useInstanceStore } from '../../store/instance-store.js';
import { usePrototypeViewStore } from '../../store/prototype-view-store.js';
import { InstancePayloadPanel } from '../../components/InstancePayloadPanel.js';
import { downloadFile, sanitizeDownloadFilename } from '../../services/export.js';
import { viewTypeInExplore } from '../../services/explore-navigation.js';
import { payloadPointerToFieldPath } from '../../services/instance-payload-graph.js';
import { Button } from '@rune-langium/design-system/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@rune-langium/design-system/ui/collapsible';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@rune-langium/design-system/ui/tabs';
import { InstanceFormPanel } from './InstanceFormPanel.js';
import { InstanceFunctionPanel } from './InstanceFunctionPanel.js';
import { withInstrumentation } from '../../services/instrumentation/core.js';

export interface InstanceInspectorPanelProps {
  instanceId: string;
  focusedPayloadPointer?: string;
  focusRequestId?: number;
}

function saveStatusText(saveState: { state: string; message?: string } | undefined): string {
  if (saveState?.state === 'failed') return `Save failed: ${saveState.message}`;
  const state = saveState?.state ?? 'unsaved';
  return state.charAt(0).toUpperCase() + state.slice(1);
}

export const InstanceInspectorPanel = withInstrumentation(
  function InstanceInspectorPanel({ instanceId, focusedPayloadPointer, focusRequestId }: InstanceInspectorPanelProps) {
    const record = useInstanceStore((s) => s.instances[instanceId]);
    const diagnostics = useInstanceStore((s) => s.validationErrors[instanceId]) ?? [];
    const validationStatus = useInstanceStore((s) => s.validationStatus[instanceId]);
    const schemaError = useInstanceStore((s) => (record ? s.schemaErrors.get(record.typeFqn) : undefined));
    const saveState = useInstanceStore((s) => s.saveStates[instanceId]);
    const retrySave = useInstanceStore((s) => s.retrySave);
    const retryInstance = useInstanceStore((s) => s.retryInstance);
    const flushInstance = useInstanceStore((s) => s.flushInstance);
    const view = usePrototypeViewStore((s) => s.state);
    const patchView = usePrototypeViewStore((s) => s.patch);
    const [functionState, setFunctionState] = useState<FunctionSessionState>();
    const [validationExpanded, setValidationExpanded] = useState(false);

    const destinationRef = useRef<HTMLDivElement>(null);
    const schema = useInstanceStore((s) => (record ? s.schemas.get(record.typeFqn) : undefined));

    const arrivalRequest = useMemo(
      () => ({ instanceId, focusedPayloadPointer, focusRequestId }),
      [instanceId, focusedPayloadPointer, focusRequestId]
    );
    const consumedArrivalRef = useRef<typeof arrivalRequest | undefined>(undefined);
    const clearArrivalRef = useRef<(() => void) | undefined>(undefined);
    useEffect(
      () => () => {
        clearArrivalRef.current?.();
        clearArrivalRef.current = undefined;
      },
      [arrivalRequest, record?.id]
    );

    useEffect(() => {
      if (consumedArrivalRef.current === arrivalRequest || !record) return;
      const fieldPath =
        arrivalRequest.focusedPayloadPointer && payloadPointerToFieldPath(arrivalRequest.focusedPayloadPointer);
      if (!fieldPath) return;
      patchView({ inspectorTab: 'form' });
      const frame = requestAnimationFrame(() => {
        const target = Array.from(
          destinationRef.current?.querySelectorAll<HTMLElement>('[data-field-path]') ?? []
        ).find((element) => element.dataset.fieldPath === fieldPath);
        if (!target) return;
        consumedArrivalRef.current = arrivalRequest;
        const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        target.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
        clearArrivalRef.current = emphasizeNavigationArrival(target);
        const input = target?.querySelector<HTMLElement>('input, button, [role="combobox"]');
        (input ?? target)?.focus({ preventScroll: true });
      });
      return () => cancelAnimationFrame(frame);
    }, [arrivalRequest, record?.id, schema, patchView]);

    if (!record) return null;
    const functionPayload: PayloadView | undefined =
      view.inspectorTab === 'functions' && functionState?.functionFqn
        ? functionState.status === 'succeeded'
          ? { kind: 'result', value: functionState.result }
          : { kind: 'inputs', value: functionState.inputs }
        : undefined;
    const payload = functionPayload ?? { kind: 'instance' as const, value: record.data };

    return (
      <div ref={destinationRef} className="@container flex h-full min-h-0 flex-col overflow-hidden text-sm">
        <header className="shrink-0 border-b border-border px-3 py-2">
          <h2 className="truncate text-sm font-semibold">{record.name}</h2>
          <p className="truncate text-xs text-muted-foreground">{record.typeFqn}</p>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="mt-1"
            onClick={() => viewTypeInExplore(record.typeFqn)}
          >
            View type in Explore
          </Button>
          <p role="status" aria-label="Save status" className="mt-1 text-xs text-muted-foreground">
            {saveStatusText(saveState)}
          </p>
          {saveState?.state === 'failed' ? (
            <button type="button" className="mt-1 text-xs underline" onClick={() => void retrySave(instanceId)}>
              Retry save
            </button>
          ) : null}
        </header>
        <div className="studio-scroll grid min-h-0 flex-1 grid-cols-1 overflow-auto @3xl:grid-cols-[minmax(0,1fr)_18rem] @3xl:grid-rows-[minmax(0,1fr)] @3xl:overflow-hidden">
          <Tabs
            value={view.inspectorTab}
            onValueChange={(value) => patchView({ inspectorTab: value as 'form' | 'functions' })}
            className="flex min-h-64 min-w-0 flex-col py-3 @3xl:min-h-0"
          >
            <TabsList className="mx-3 shrink-0 self-start">
              <TabsTrigger value="form">Form</TabsTrigger>
              <TabsTrigger value="functions">Functions</TabsTrigger>
            </TabsList>
            <TabsContent value="form" className="min-h-0 flex-1 overflow-auto">
              <InstanceFormPanel key={record.id} instanceId={record.id} />
            </TabsContent>
            <TabsContent value="functions" className="min-h-0 flex-1 overflow-auto">
              <InstanceFunctionPanel instanceId={record.id} onStateChange={setFunctionState} />
            </TabsContent>
          </Tabs>
          <aside
            aria-label="Instance details"
            className="min-w-0 border-t border-border @3xl:overflow-auto @3xl:border-t-0 @3xl:border-l"
          >
            <section aria-label="Instance validation" className="px-3 pt-2">
              <h3 className="mb-1 font-semibold">Validation</h3>
              {validationStatus === 'pending' || !validationStatus ? (
                <p role="status" className="text-muted-foreground">
                  Checking…
                </p>
              ) : validationStatus === 'unavailable' ? (
                <>
                  <p className="text-muted-foreground">
                    {schemaError?.message ?? 'Instance validation is unavailable.'}
                  </p>
                  <button
                    type="button"
                    className="mt-1 text-xs underline"
                    onClick={() => void retryInstance(instanceId)}
                  >
                    Retry validation
                  </button>
                </>
              ) : diagnostics.length === 0 ? (
                <p role="status" className="text-muted-foreground">
                  Valid
                </p>
              ) : (
                <Collapsible open={validationExpanded} onOpenChange={setValidationExpanded}>
                  <CollapsibleTrigger render={<Button variant="ghost" size="xs" />}>
                    {diagnostics.length} {diagnostics.length === 1 ? 'issue' : 'issues'}
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <ul className="studio-scroll mt-2 max-h-32 space-y-1 overflow-auto break-words text-xs text-destructive">
                      {diagnostics.map((d, i) => (
                        <li key={`${d.path}-${i}`}>
                          <span>{d.path}</span>: <span>{d.message}</span>
                        </li>
                      ))}
                    </ul>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </section>
            <section className="flex flex-wrap items-center gap-x-2 px-3 pt-2 text-xs">
              <h3 className="font-medium">Provenance</h3>
              <p className="text-muted-foreground">{record.provenance?.codec ?? 'manual'}</p>
            </section>
            <InstancePayloadPanel
              payload={payload}
              onExport={async () => {
                if (payload.kind === 'instance') await flushInstance(record.id);
                downloadFile(
                  JSON.stringify(payload.value, null, 2),
                  sanitizeDownloadFilename(
                    `${record.name}${payload.kind === 'instance' ? '' : `-${payload.kind}`}.json`,
                    'payload.json'
                  ),
                  'application/json'
                );
              }}
            />
          </aside>
        </div>
      </div>
    );
  },
  { op: 'InstanceInspectorPanel' }
);
