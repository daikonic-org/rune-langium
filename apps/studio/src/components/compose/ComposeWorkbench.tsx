// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Daikonic contributors
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import type { DockviewApi } from 'dockview-react';
import { ChevronLeft, X } from 'lucide-react';
import { Button } from '@rune-langium/design-system/ui/button';
import { Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger } from '@rune-langium/design-system/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@rune-langium/design-system/ui/tabs';
import { WorkbenchHost } from '../../shell/WorkbenchHost.js';
import { COLLAPSED_SIDE_WIDTH } from '../../shell/responsive-layout.js';
import { readWorkbenchSettings, writeWorkbenchSettings } from '../../shell/workbench-settings.js';
import type { WorkbenchDefinition } from '../../shell/workbench-types.js';
import { withInstrumentation } from '../../services/instrumentation/core.js';

const preference = 'compose-dock';
const compactQuery = '(max-width: 899px)';
const sides = [
  { id: 'compose.palette', position: 'left', title: 'Palette', width: 232, minimum: 180, maximum: 400 },
  { id: 'compose.details', position: 'right', title: 'Details', width: 304, minimum: 220, maximum: 480 }
] as const;

function addTestTab(api: DockviewApi) {
  const details = api.getPanel('compose.details');
  if (details && !api.getPanel('compose.test')) {
    api.addPanel({
      id: 'compose.test',
      component: 'compose.test',
      title: 'Test',
      inactive: true,
      position: { referencePanel: details.id, direction: 'within' }
    });
  }
}

function buildDefault(api: DockviewApi, width: number) {
  const center = api.addPanel({
    id: 'compose.center',
    component: 'compose.center',
    title: 'Composition',
    renderer: 'onlyWhenVisible'
  });
  for (const side of sides) {
    const edge = api.addEdgeGroup(side.position, {
      id: side.id + '.edge',
      initialSize: side.width,
      minimumSize: side.minimum,
      maximumSize: side.maximum,
      collapsedSize: COLLAPSED_SIDE_WIDTH,
      collapsed: width < 900
    });
    const group = api.groups.find(({ id }) => id === edge.id);
    if (!group) continue;
    api.addPanel({
      id: side.id,
      component: side.id,
      title: side.title,
      renderer: 'always',
      inactive: true,
      position: { referenceGroup: group, direction: 'within' }
    });
  }
  addTestTab(api);
  center.api.setActive();
}

// Dockview's pointer sashes are divs. Use the same native size operation for keyboard input.
function nameEdgeSashes(dock: DockviewApi, host: HTMLElement) {
  const selector = '.dv-shell > .dv-split-view-container.dv-horizontal > .dv-sash-container > .dv-sash';
  const sashes = () => [...host.querySelectorAll<HTMLElement>(selector)];
  const refresh = () => {
    const edges = sides.filter((side) => dock.getEdgeGroup(side.position));
    const elements = sashes();
    for (const [index, element] of elements.entries()) {
      const edge = elements.length === edges.length ? edges[index] : undefined;
      const group = edge && dock.getEdgeGroup(edge.position);
      if (!group || group.isCollapsed() || element.classList.contains('dv-disabled')) {
        delete element.dataset.composeResize;
        element.removeAttribute('tabindex');
        element.removeAttribute('role');
        element.removeAttribute('aria-label');
        element.removeAttribute('aria-orientation');
        element.removeAttribute('aria-valuemin');
        element.removeAttribute('aria-valuemax');
        element.removeAttribute('aria-valuenow');
        continue;
      }
      element.dataset.composeResize = edge.position;
      element.tabIndex = 0;
      element.setAttribute('role', 'separator');
      element.setAttribute('aria-label', 'Resize composition ' + edge.title.toLowerCase());
      element.setAttribute('aria-orientation', 'vertical');
      element.setAttribute('aria-valuemin', String(edge.minimum));
      element.setAttribute('aria-valuemax', String(edge.maximum));
      element.setAttribute('aria-valuenow', String(Math.round(group.width)));
    }
  };
  const keyboardResize = (event: KeyboardEvent) => {
    if (!(event.target instanceof HTMLElement) || !event.target.dataset.composeResize) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const position = event.target.dataset.composeResize;
    const side = sides.find((entry) => entry.position === position);
    if (!side) return;
    const edge = dock.getEdgeGroup(side.position);
    if (!edge || edge.isCollapsed()) return;
    event.preventDefault();
    const grow = (event.key === 'ArrowRight') === (side.position === 'left');
    edge.setSize({ width: edge.width + (grow ? 16 : -16) });
  };
  let frame = 0;
  const scheduleRefresh = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(refresh);
  };
  refresh();
  const listeners = [
    dock.onDidLayoutChange(scheduleRefresh),
    ...sides.flatMap(({ position }) => {
      const edge = dock.getEdgeGroup(position);
      return edge ? [edge.onDidCollapsedChange(scheduleRefresh)] : [];
    })
  ];
  host.addEventListener('keydown', keyboardResize);
  return () => {
    cancelAnimationFrame(frame);
    listeners.forEach((listener) => listener.dispose());
    host.removeEventListener('keydown', keyboardResize);
  };
}

export const ComposeWorkbench = withInstrumentation(
  function ComposeWorkbench({
    workspaceKey,
    layoutKey,
    active,
    onReady,
    palette,
    center,
    details,
    test
  }: {
    workspaceKey: string;
    layoutKey: string;
    active: boolean;
    onReady(api: DockviewApi): void;
    palette: ReactElement;
    center: ReactElement;
    details(dismiss?: () => void): ReactElement;
    test: ReactElement;
  }) {
    const [restored, setRestored] = useState<{ key: string; layout: unknown }>();
    const [dock, setDock] = useState<DockviewApi>();
    const [compact, setCompact] = useState(() => window.matchMedia?.(compactQuery).matches ?? false);
    const [detailsOpen, setDetailsOpen] = useState(false);
    const [detailView, setDetailView] = useState<'details' | 'test'>('details');
    const [detailsHost] = useState(() => {
      const element = document.createElement('div');
      element.className = 'h-full min-h-0';
      return element;
    });
    const attachDetails = useCallback((element: HTMLDivElement | null) => element?.append(detailsHost), [detailsHost]);
    const host = useRef<HTMLDivElement>(null);
    const persistLayout = useCallback(
      (layout: unknown) => {
        if (active && !window.matchMedia?.(compactQuery).matches)
          void writeWorkbenchSettings(layoutKey, preference, layout).catch(() => undefined);
      },
      [active, layoutKey]
    );
    useEffect(() => {
      if (dock && host.current) return nameEdgeSashes(dock, host.current);
    }, [dock]);

    useEffect(() => {
      const group = dock?.getPanel('compose.details')?.group;
      const edge = dock?.getEdgeGroup('right');
      if (!group || !edge) return;
      setDetailView(group.activePanel?.id === 'compose.test' ? 'test' : 'details');
      const selection = group.api.onDidActivePanelChange(({ panel }) => {
        setDetailView(panel.id === 'compose.test' ? 'test' : 'details');
      });
      const collapse = edge.onDidCollapsedChange(() => {
        if (!edge.isCollapsed() && window.matchMedia?.(compactQuery).matches) {
          // A compact rail tab opens the same overlay as the chevron.
          edge.collapse();
          setDetailsOpen(true);
        }
      });
      return () => {
        selection.dispose();
        collapse.dispose();
      };
    }, [dock]);

    useEffect(() => {
      if (!dock || !active) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const scheduleSave = () => {
        clearTimeout(timer);
        timer = setTimeout(() => persistLayout(dock.toJSON()), 150);
      };
      const listeners = sides.flatMap((side) => {
        const group = dock.getPanel(side.id)?.group;
        return group ? [group.api.onDidDimensionsChange(scheduleSave)] : [];
      });
      return () => {
        clearTimeout(timer);
        listeners.forEach((listener) => listener.dispose());
      };
    }, [dock, active, persistLayout]);

    useEffect(() => {
      let current = true;
      void readWorkbenchSettings<unknown>(layoutKey, preference, undefined)
        .then(
          (layout) =>
            layout ??
            (workspaceKey === layoutKey ? undefined : readWorkbenchSettings(workspaceKey, preference, undefined))
        )
        .catch(() => undefined)
        .then((layout) => {
          if (current) setRestored({ key: workspaceKey, layout });
        });
      return () => {
        current = false;
      };
    }, [workspaceKey, layoutKey]);

    useEffect(() => {
      if (!dock) return;
      const media = window.matchMedia?.(compactQuery);
      if (!media) return;
      const expanded = new Set<string>();
      const desktopWidths = new Map<string, number>();
      let restoreFrame = 0;
      let desktop = !media.matches;
      const edges = () =>
        sides.flatMap((side) => {
          const edge = dock.getEdgeGroup(side.position);
          return edge?.id === side.id + '.edge' ? [edge] : [];
        });
      const rememberWidths = () => {
        if (!desktop || media.matches) return;
        for (const edge of edges()) {
          if (!edge.isCollapsed() && edge.width > COLLAPSED_SIDE_WIDTH) desktopWidths.set(edge.id, edge.width);
        }
      };
      const adapt = () => {
        if (desktop && !media.matches) return;
        cancelAnimationFrame(restoreFrame);
        restoreFrame = 0;
        desktop = false;
        setCompact(media.matches);
        if (media.matches) {
          for (const edge of edges()) {
            if (!edge.isCollapsed()) expanded.add(edge.id);
            edge.collapse();
          }
        } else {
          setDetailsOpen(false);
          // The media query can change before Dockview measures its host.
          // Size the dock before restoring rail widths to avoid compact constraints.
          restoreFrame = requestAnimationFrame(() => {
            const element = host.current;
            if (element?.clientWidth && element.clientHeight) dock.layout(element.clientWidth, element.clientHeight);
            for (const edge of edges()) {
              if (expanded.delete(edge.id)) edge.expand();
            }
            for (const edge of edges()) {
              const width = desktopWidths.get(edge.id);
              if (width !== undefined) edge.setSize({ width });
            }
            restoreFrame = 0;
            desktop = true;
            rememberWidths();
          });
        }
      };
      rememberWidths();
      const layoutListener = dock.onDidLayoutChange(rememberWidths);
      media.addEventListener('change', adapt);
      adapt();
      return () => {
        cancelAnimationFrame(restoreFrame);
        layoutListener.dispose();
        media.removeEventListener('change', adapt);
      };
    }, [dock]);

    const definition: WorkbenchDefinition = {
      id: 'compose',
      panels: {
        'compose.palette': () => palette,
        'compose.center': () => center,
        'compose.details': () => (compact ? null : <div className="h-full min-h-0" ref={attachDetails} />),
        'compose.test': () => (compact ? null : test)
      },
      titles: {
        'compose.palette': 'Palette',
        'compose.center': 'Composition',
        'compose.details': 'Details',
        'compose.test': 'Test'
      },
      collapsedSideActions: compact
        ? {
            right: (
              <DialogTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="text-muted-foreground"
                    aria-label="Show details"
                    title="Show details"
                  />
                }
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
              </DialogTrigger>
            )
          }
        : undefined,
      buildDefault,
      reconcile: addTestTab
    };
    return (
      <Dialog open={active && compact && detailsOpen} onOpenChange={setDetailsOpen}>
        <div
          ref={host}
          className="function-composer__body min-h-0 min-w-0 flex-1 overflow-clip"
          data-testid="compose-dock"
        >
          {restored?.key === workspaceKey ? (
            <WorkbenchHost
              key={workspaceKey}
              className="h-full min-w-0 w-full"
              definition={definition}
              initialNativeLayout={restored.layout}
              onReady={(api) => {
                // Keep the center inside its dock group as the surrounding rails move.
                api.getPanel('compose.center')?.api.setRenderer('onlyWhenVisible');
                setDock(api);
                onReady(api);
              }}
              onNativeLayoutChange={persistLayout}
            />
          ) : (
            <p role="status" className="p-3">
              Restoring Compose layout…
            </p>
          )}
        </div>
        {compact && (
          <DialogContent
            className="flex h-[min(80dvh,36rem)] w-[calc(100%-2rem)] flex-col gap-0 p-0"
            showCloseButton={false}
          >
            <DialogTitle className="sr-only">Details</DialogTitle>
            <Tabs
              value={detailView}
              onValueChange={(value) =>
                dock?.getPanel(value === 'test' ? 'compose.test' : 'compose.details')?.api.setActive()
              }
              className="min-h-0 flex-1 gap-0"
            >
              <div className="flex shrink-0 items-center gap-1 border-b border-border px-2">
                <TabsList size="sm" aria-label="Composition details view" className="flex-1 justify-start border-0">
                  <TabsTrigger value="details">Details</TabsTrigger>
                  <TabsTrigger value="test">Test</TabsTrigger>
                </TabsList>
                <DialogClose render={<Button size="icon-xs" variant="ghost" aria-label="Hide details" />}>
                  <X aria-hidden="true" />
                </DialogClose>
              </div>
              <TabsContent value="details" className="mt-0 min-h-0 flex-1" ref={attachDetails} />
              <TabsContent value="test" className="mt-0 min-h-0 flex-1">
                {test}
              </TabsContent>
            </Tabs>
          </DialogContent>
        )}
        {createPortal(details(compact ? () => setDetailsOpen(false) : undefined), detailsHost)}
      </Dialog>
    );
  },
  { op: 'ComposeWorkbench', capture: 0 }
);
