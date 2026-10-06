// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import type { DockviewApi, DockviewReadyEvent, IDockviewPanelProps, IDockviewHeaderActionsProps } from 'dockview-react';
import { Pin, PinOff } from 'lucide-react';
import { Button } from '@rune-langium/design-system/ui/button';
import { DockLayout } from '@rune-langium/design-system/ui/dock-layout';
import { restoreNativeLayout } from './dockview-bridge.js';
import { StudioDockTab } from './StudioDockTab.js';
import type { WorkbenchDefinition, WorkbenchHostProps } from './workbench-types.js';
import { withInstrumentation } from '../services/instrumentation/core.js';
import { useDesignPreviewStore } from '../store/design-preview-store.js';
import { collapseAuxiliaryPanels, type AuxiliaryPanelLayout } from './auxiliary-panel-layout.js';

export const WorkbenchDefinitionContext = createContext<WorkbenchDefinition | null>(null);

const HeaderActionsContext = createContext<{
  auxiliary: AuxiliaryPanelLayout | null;
  refresh(): void;
  original?: WorkbenchHostProps['rightHeaderActionsComponent'];
}>({ auxiliary: null, refresh: () => {} });

function WorkbenchHeaderActions(props: IDockviewHeaderActionsProps) {
  const { auxiliary, refresh, original: Original } = useContext(HeaderActionsContext);
  if (!auxiliary?.isManaged(props.group.id)) return Original ? <Original {...props} /> : null;
  const pinned = auxiliary.isPinned(props.group.id);
  return (
    <>
      {Original ? <Original {...props} /> : null}
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label={pinned ? 'Unpin auxiliary panel' : 'Pin auxiliary panel'}
        title={pinned ? 'Unpin auxiliary panel' : 'Pin auxiliary panel'}
        aria-pressed={pinned}
        onClick={() => {
          auxiliary.togglePin(props.group.id);
          refresh();
        }}
      >
        {pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
      </Button>
    </>
  );
}

function PanelBody({ name }: { name: string }): React.ReactElement | null {
  const definition = useContext(WorkbenchDefinitionContext);
  if (!definition) throw new Error('PanelBody requires WorkbenchHost');
  // Panel renderers deliberately run inside this stable bridge. Rendering a
  // changing callback as <Component /> changes React's element type and
  // remounts its local state whenever surrounding perspective state updates.
  const render = definition.panels[name] as ((props: object) => React.ReactElement | null) | undefined;
  return render?.({}) ?? null;
}

function createDockviewPanelBridge(name: string): React.FC<IDockviewPanelProps> {
  function DockviewPanelBridge() {
    return <PanelBody name={name} />;
  }
  DockviewPanelBridge.displayName = `DockviewPanelBridge(${name})`;
  return DockviewPanelBridge;
}

function viewportWidth(): number {
  return typeof window === 'undefined' ? 1920 : window.innerWidth;
}

export const resetWorkbench = withInstrumentation(
  function resetWorkbench(api: DockviewApi, definition: WorkbenchDefinition, width: number): void {
    api.clear();
    definition.buildDefault(api, width);
  },
  { op: 'resetWorkbench' }
);

export const WorkbenchHost = withInstrumentation(
  function WorkbenchHost({
    definition,
    initialNativeLayout,
    initialLayout,
    onNativeLayoutChange,
    onNativeLayoutError,
    onRestoreFallback,
    onReady,
    className,
    defaultTabComponent,
    rightHeaderActionsComponent
  }: WorkbenchHostProps): React.ReactElement {
    const definitionRef = useRef(definition);
    definitionRef.current = definition;
    const initialNativeLayoutRef = useRef(initialNativeLayout);
    const initialLayoutRef = useRef(initialLayout);
    const onNativeLayoutChangeRef = useRef(onNativeLayoutChange);
    onNativeLayoutChangeRef.current = onNativeLayoutChange;
    const onNativeLayoutErrorRef = useRef(onNativeLayoutError);
    onNativeLayoutErrorRef.current = onNativeLayoutError;
    const onRestoreFallbackRef = useRef(onRestoreFallback);
    onRestoreFallbackRef.current = onRestoreFallback;
    const onReadyRef = useRef(onReady);
    onReadyRef.current = onReady;
    const listenerRef = useRef<{ dispose(): void } | null>(null);
    const apiRef = useRef<DockviewApi | null>(null);
    const mountedRef = useRef(true);
    const [auxiliary, setAuxiliary] = useState<AuxiliaryPanelLayout | null>(null);
    const [, setPinRevision] = useState(0);
    const collapseAuxiliary = useDesignPreviewStore((state) => state.preferences.auxiliary);
    const restoringPreviewRef = useRef(false);

    useEffect(() => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
      };
    }, []);

    useEffect(() => {
      const api = apiRef.current;
      if (!api || !collapseAuxiliary) return;
      const controller = collapseAuxiliaryPanels(api, definitionRef.current.id);
      setAuxiliary(controller);
      return () => {
        restoringPreviewRef.current = true;
        controller.dispose(mountedRef.current);
        setAuxiliary(null);
        queueMicrotask(() => {
          restoringPreviewRef.current = false;
        });
      };
    }, [collapseAuxiliary]);

    const panelNames = Object.keys(definition.panels).sort().join('\u0000');
    const components = useMemo(
      () =>
        Object.fromEntries(
          panelNames ? panelNames.split('\u0000').map((name) => [name, createDockviewPanelBridge(name)]) : []
        ),
      [panelNames]
    );

    const handleReady = useCallback((event: DockviewReadyEvent) => {
      apiRef.current = event.api;
      listenerRef.current?.dispose();
      const currentDefinition = definitionRef.current;
      try {
        if (initialNativeLayoutRef.current !== undefined) {
          restoreNativeLayout(
            event.api,
            initialNativeLayoutRef.current,
            new Set(Object.keys(currentDefinition.panels))
          );
        } else if (initialLayoutRef.current) {
          initialLayoutRef.current(event.api, viewportWidth());
        } else {
          currentDefinition.buildDefault(event.api, viewportWidth());
        }
        currentDefinition.reconcile?.(event.api, viewportWidth());
      } catch {
        event.api.clear();
        currentDefinition.buildDefault(event.api, viewportWidth());
        currentDefinition.reconcile?.(event.api, viewportWidth());
        onRestoreFallbackRef.current?.();
      }

      listenerRef.current = event.api.onDidLayoutChange(() => {
        if (event.api.panels.length === 0) return;
        // Comparing designs must not overwrite the workspace's saved arrangement.
        if (restoringPreviewRef.current || useDesignPreviewStore.getState().preferences.auxiliary) return;
        try {
          onNativeLayoutChangeRef.current(event.api.toJSON());
        } catch (error) {
          onNativeLayoutErrorRef.current?.(error);
        }
      });
      onReadyRef.current?.(event.api);
    }, []);

    useEffect(
      () => () => {
        listenerRef.current?.dispose();
        listenerRef.current = null;
      },
      []
    );

    return (
      <WorkbenchDefinitionContext.Provider value={definition}>
        <HeaderActionsContext.Provider
          value={{
            auxiliary,
            refresh: () => setPinRevision((revision) => revision + 1),
            original: rightHeaderActionsComponent
          }}
        >
          <DockLayout
            components={components}
            defaultTabComponent={defaultTabComponent ?? StudioDockTab}
            rightHeaderActionsComponent={WorkbenchHeaderActions}
            onReady={handleReady}
            className={className}
          />
        </HeaderActionsContext.Provider>
      </WorkbenchDefinitionContext.Provider>
    );
  },
  { op: 'WorkbenchHost' }
);
