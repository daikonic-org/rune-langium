// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Daikonic contributors
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type { DockviewApi } from 'dockview-react';
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
    details
  }: {
    workspaceKey: string;
    layoutKey: string;
    active: boolean;
    onReady(api: DockviewApi): void;
    palette: ReactElement;
    center: ReactElement;
    details: ReactElement;
  }) {
    const [restored, setRestored] = useState<{ key: string; layout: unknown }>();
    const [dock, setDock] = useState<DockviewApi>();
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
      const adapt = () => {
        for (const side of sides) {
          const edge = dock.getEdgeGroup(side.position);
          if (edge?.id !== side.id + '.edge') continue;
          if (media.matches) {
            if (!edge.isCollapsed()) expanded.add(edge.id);
            edge.collapse();
          } else if (expanded.delete(edge.id)) {
            edge.expand();
          }
        }
      };
      media.addEventListener('change', adapt);
      adapt();
      return () => media.removeEventListener('change', adapt);
    }, [dock]);

    const definition: WorkbenchDefinition = {
      id: 'compose',
      panels: {
        'compose.palette': () => palette,
        'compose.center': () => center,
        'compose.details': () => details
      },
      titles: { 'compose.palette': 'Palette', 'compose.center': 'Composition', 'compose.details': 'Details' },
      buildDefault
    };
    return (
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
    );
  },
  { op: 'ComposeWorkbench', capture: 0 }
);
