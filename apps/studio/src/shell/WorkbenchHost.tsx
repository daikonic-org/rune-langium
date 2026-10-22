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
import {
  collapseAuxiliaryPanels,
  consolidateExplorePreviewPanels,
  getExploreSidePanel,
  type AuxiliaryPanelLayout
} from './auxiliary-panel-layout.js';
import { PanelCollapseButton } from './PanelCollapseButton.js';
import { EXPLORE_PREVIEW_WIDTH, PANEL_TITLES } from './layout-factory.js';

export const WorkbenchDefinitionContext = createContext<WorkbenchDefinition | null>(null);

interface SidePanelLayout {
  expandedWidth: number;
  expandedConstraints: { minimumWidth: number; maximumWidth: number };
  ownsCollapsedConstraints: boolean;
}

const HeaderActionsContext = createContext<{
  auxiliary: AuxiliaryPanelLayout | null;
  sideLayouts: WeakMap<IDockviewHeaderActionsProps['group'], SidePanelLayout>;
  refresh(): void;
  original?: WorkbenchHostProps['rightHeaderActionsComponent'];
}>({ auxiliary: null, sideLayouts: new WeakMap(), refresh: () => {} });

const COLLAPSED_SIDE_WIDTH = 52;

function setPreviewPanelTitles(group: IDockviewHeaderActionsProps['group'], collapsed: boolean): void {
  for (const panel of group.panels) {
    const component = panel.api.component;
    if (component === 'workspace.formPreview' || component === 'workspace.codePreview') {
      const title = PANEL_TITLES[component];
      panel.api.setTitle(collapsed ? `${title} Preview` : title);
    }
  }
}

function SidePanelHeaderAction({
  group,
  label,
  direction,
  auxiliary
}: {
  group: IDockviewHeaderActionsProps['group'];
  label: string;
  direction: 'left' | 'right';
  auxiliary: AuxiliaryPanelLayout | null;
}) {
  const isCollapsed = () =>
    group.api.location.type === 'edge' ? group.api.isCollapsed() : group.api.width <= COLLAPSED_SIDE_WIDTH + 1;
  const [collapsed, setCollapsed] = useState(isCollapsed);
  // Header orientation can recreate this component; the workbench owns its size memory.
  const { sideLayouts } = useContext(HeaderActionsContext);
  let layout = sideLayouts.get(group);
  if (!layout) {
    layout = {
      expandedWidth: direction === 'left' ? 240 : EXPLORE_PREVIEW_WIDTH,
      expandedConstraints: {
        minimumWidth: group.minimumWidth === COLLAPSED_SIDE_WIDTH ? 0 : group.minimumWidth,
        maximumWidth: group.maximumWidth === COLLAPSED_SIDE_WIDTH ? Infinity : group.maximumWidth
      },
      ownsCollapsedConstraints: false
    };
    sideLayouts.set(group, layout);
  }
  const sideLayout = layout;
  useEffect(() => {
    const update = () => {
      const next = isCollapsed();
      if (!next && group.api.location.type === 'grid') sideLayout.expandedWidth = group.api.width;
      setCollapsed(next);
    };
    update();
    const collapseListener = group.api.onDidCollapsedChange(update);
    const sizeListener = group.api.onDidDimensionsChange(update);
    return () => {
      collapseListener.dispose();
      sizeListener.dispose();
      // A user can move the main task into this group; release our rail bounds.
      if (
        sideLayout.ownsCollapsedConstraints &&
        group.element.isConnected &&
        group.panels.length > 0 &&
        group.api.location.type === 'grid' &&
        !getExploreSidePanel(group.panels.map((panel) => panel.api.component))
      ) {
        group.api.setConstraints(sideLayout.expandedConstraints);
        group.api.setSize({ width: sideLayout.expandedWidth });
      }
    };
  }, [group]);
  useEffect(() => {
    const element = group.element;
    element.classList.add('studio-side-panel');
    return () => {
      element.classList.remove('studio-side-panel', 'studio-side-panel-collapsed');
      // Dockview can recreate header actions when their orientation changes.
      // Restore only when this group has stopped being a dedicated side panel.
      if (
        element.isConnected &&
        group.panels.length > 0 &&
        !getExploreSidePanel(group.panels.map((panel) => panel.api.component))
      ) {
        setPreviewPanelTitles(group, false);
        group.api.setHeaderPosition('top');
      }
    };
  }, [group]);
  useEffect(() => {
    group.element.classList.toggle('studio-side-panel-collapsed', collapsed);
    setPreviewPanelTitles(group, collapsed);
    const position = collapsed ? direction : 'top';
    if (group.api.getHeaderPosition() !== position) group.api.setHeaderPosition(position);
  }, [group, collapsed, direction]);
  const toggle = () => {
    if (group.api.location.type === 'edge') {
      if (auxiliary?.isManaged(group.id)) auxiliary.setCollapsed(group.id, !collapsed);
      else if (collapsed) group.api.expand();
      else group.api.collapse();
    } else {
      // Match the utility tray's resize approach without removing the panel's DOM.
      const width = sideLayout.expandedWidth;
      if (collapsed) {
        sideLayout.ownsCollapsedConstraints = false;
        group.api.setConstraints(sideLayout.expandedConstraints);
        group.api.setSize({ width });
      } else {
        sideLayout.ownsCollapsedConstraints = true;
        sideLayout.expandedConstraints = { minimumWidth: group.minimumWidth, maximumWidth: group.maximumWidth };
        group.api.setConstraints({ minimumWidth: COLLAPSED_SIDE_WIDTH, maximumWidth: COLLAPSED_SIDE_WIDTH });
        group.api.setSize({ width: COLLAPSED_SIDE_WIDTH });
      }
    }
  };
  return (
    <div className="studio-panel-actions mr-1">
      <PanelCollapseButton label={label} direction={direction} collapsed={collapsed} onToggle={toggle} />
    </div>
  );
}

function WorkbenchHeaderActions(props: IDockviewHeaderActionsProps) {
  const { auxiliary, refresh, original: Original } = useContext(HeaderActionsContext);
  const side = getExploreSidePanel(props.group.panels?.map((panel) => panel.api.component) ?? []);
  if (side) return <SidePanelHeaderAction group={props.group} {...side} auxiliary={auxiliary} />;
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
    const sideLayouts = useMemo(() => new WeakMap<IDockviewHeaderActionsProps['group'], SidePanelLayout>(), []);
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

    useEffect(() => {
      const api = apiRef.current;
      if (api) definition.reconcile?.(api, viewportWidth());
    }, [definition]);

    const panelBridges = useRef(new Map<string, React.FC<IDockviewPanelProps>>());
    const panelNames = Object.keys(definition.panels).sort().join('\u0000');
    const components = useMemo(
      () =>
        Object.fromEntries(
          panelNames
            ? panelNames.split('\u0000').map((name) => {
                let bridge = panelBridges.current.get(name);
                if (!bridge) {
                  bridge = createDockviewPanelBridge(name);
                  panelBridges.current.set(name, bridge);
                }
                return [name, bridge];
              })
            : []
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

      if (currentDefinition.id === 'explore') {
        consolidateExplorePreviewPanels(event.api);
        for (const panel of event.api.panels) {
          if (panel.api.component === 'workspace.fileTree') panel.api.setTitle(PANEL_TITLES['workspace.fileTree']);
        }
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
            sideLayouts,
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
