// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import type { DockviewApi, EdgeGroupPosition } from 'dockview-react';
import type { WorkbenchDefinition } from './workbench-types.js';
import { withInstrumentation } from '../services/instrumentation/core.js';

const AUXILIARY_PANELS: Record<WorkbenchDefinition['id'], Record<string, EdgeGroupPosition>> = {
  explore: {
    'workspace.fileTree': 'left',
    'workspace.formPreview': 'right',
    'workspace.codePreview': 'right',
    'workspace.problems': 'bottom',
    'workspace.activity': 'bottom',
    'workspace.output': 'bottom'
  },
  prototype: { 'prototype.grid': 'bottom', 'prototype.payloadGraph': 'right' },
  export: { 'export.settings': 'right', 'export.preview': 'bottom' }
};

/** Dedicated Explore side groups; never include a group shared with the main task. */
export const getExploreSidePanel = withInstrumentation(
  function getExploreSidePanel(components: readonly string[]) {
    const direction = AUXILIARY_PANELS.explore[components[0] ?? ''];
    if (
      (direction === 'left' || direction === 'right') &&
      components.every((component) => AUXILIARY_PANELS.explore[component] === direction)
    )
      return { direction, label: direction === 'left' ? 'Type explorer' : 'Preview panel' };
  },
  { op: 'getExploreSidePanel' }
);

/** Restore older split preview columns as one Form/Code group without replacing views. */
export const consolidateExplorePreviewPanels = withInstrumentation(
  function consolidateExplorePreviewPanels(api: DockviewApi): void {
    const panels = api.panels.filter(
      (panel) =>
        panel.api.location.type === 'grid' &&
        getExploreSidePanel(panel.group.panels.map((item) => item.api.component))?.direction === 'right'
    );
    const anchor = panels.find((panel) => panel.api.component === 'workspace.formPreview') ?? panels[0];
    if (!anchor) return;
    const active = api.activePanel;
    for (const panel of panels) {
      if (panel.group !== anchor.group)
        panel.api.moveTo({ group: anchor.group, position: 'center', skipSetActive: true });
    }
    if (active && panels.includes(active)) active.api.setActive();
  },
  { op: 'consolidateExplorePreviewPanels' }
);

/** Use native edge-group collapse/expand; no enterprise peek-module dependency. */
export const collapseAuxiliaryPanels = withInstrumentation(
  function collapseAuxiliaryPanels(api: DockviewApi, perspective: WorkbenchDefinition['id']) {
    const original = api.toJSON();
    const pinned = new Set<string>();
    const managed = new Set<string>();
    const created = new Set<EdgeGroupPosition>();
    const headerListeners: Array<{ dispose(): void }> = [];
    const policy = AUXILIARY_PANELS[perspective];

    for (const position of ['left', 'right', 'bottom'] as const) {
      const existing = api.getEdgeGroup(position);
      const panels = api.panels.filter(
        (panel) => policy[panel.api.component] === position && panel.api.location.type === 'grid'
      );
      const edgePanels = existing ? api.panels.filter((panel) => panel.group.id === existing.id) : [];
      if (panels.length === 0 && edgePanels.length === 0) continue;
      // An edge containing the main task is a manual arrangement, not a tool strip.
      if (edgePanels.some((panel) => policy[panel.api.component] !== position)) continue;
      // Respect already docked edge panels and their chosen expanded size.
      const first = panels[0] ?? edgePanels[0]!;
      const sharesMainTask = first.group.panels.some((panel) => policy[panel.api.component] !== position);
      const edge =
        existing ??
        api.addEdgeGroup(position, {
          id: `${perspective}.auxiliary.${position}`,
          initialSize:
            position === 'bottom'
              ? sharesMainTask
                ? 220
                : Math.max(220, first.group.api.height)
              : sharesMainTask
                ? 280
                : Math.max(240, first.group.api.width),
          minimumSize: position === 'bottom' ? 120 : 180,
          collapsedSize: 34,
          collapsed: false
        });
      const group = api.groups.find((candidate) => candidate.id === edge.id);
      if (!group) continue;
      if (!existing) {
        created.add(position);
        // Expanded tools retain the normal horizontal panel/tab chrome.
        // Only collapsed side strips need a vertical header.
        edge.setHeaderPosition('top');
        if (position !== 'bottom') {
          headerListeners.push(
            edge.onDidCollapsedChange(({ isCollapsed }) => {
              edge.setHeaderPosition(isCollapsed ? position : 'top');
            })
          );
        }
      }
      if (!edge.isCollapsed()) pinned.add(edge.id);
      managed.add(edge.id);
      for (const panel of panels) panel.api.moveTo({ group, position: 'center', skipSetActive: true });
    }

    let returningFocus = false;
    const listener = api.onDidActiveGroupChange((active) => {
      // Edge tabs focus their group on pointer-down, then toggle on click.
      // Let Dockview own that toggle and keep other tool panels open.
      if (returningFocus || active?.api.location.type !== 'grid') return;
      for (const position of ['left', 'right', 'bottom'] as const) {
        const edge = api.getEdgeGroup(position);
        if (!edge || !managed.has(edge.id)) continue;
        if (!pinned.has(edge.id)) edge.collapse();
      }
    });
    let activationReady = false;
    const activation = api.onDidActivePanelChange(({ panel, origin }) => {
      // API navigation has no subsequent native tab click to open the edge.
      // Ignore the emitter's replay of the selection that existed before setup.
      if (activationReady && panel && origin === 'api' && managed.has(panel.group.id)) panel.group.api.expand();
    });
    activationReady = true;
    const keyboardListeners = api.groups
      .filter((group) => managed.has(group.id))
      .map((group) => {
        const onKeyDown = (event: KeyboardEvent) => {
          if (
            (event.key === 'Enter' || event.key === ' ') &&
            event.target instanceof Element &&
            event.target.closest('.dv-tab')
          )
            group.api.expand();
        };
        // Run after the native tab-list keyboard handler has selected the panel.
        group.element.addEventListener('keydown', onKeyDown);
        return () => group.element.removeEventListener('keydown', onKeyDown);
      });

    return {
      isManaged: (id: string) => managed.has(id),
      isPinned: (id: string) => pinned.has(id),
      setCollapsed(id: string, collapsed: boolean) {
        const group = api.groups.find((candidate) => candidate.id === id);
        if (!group || !managed.has(id)) return;
        // Explicit hide/show controls own visibility until the next user action.
        pinned.add(id);
        if (collapsed) group.api.collapse();
        else group.api.expand();
      },
      togglePin(id: string) {
        const group = api.groups.find((candidate) => candidate.id === id);
        if (!group || !managed.has(id)) return;
        if (pinned.has(id)) {
          pinned.delete(id);
          group.api.collapse();
          returningFocus = true;
          try {
            api.panels.find((panel) => panel.api.location.type === 'grid')?.api.setActive();
          } finally {
            returningFocus = false;
          }
        } else {
          pinned.add(id);
          group.api.expand();
        }
      },
      dispose(restore = true) {
        listener.dispose();
        activation.dispose();
        headerListeners.forEach((listener) => listener.dispose());
        keyboardListeners.forEach((dispose) => dispose());
        if (restore) {
          api.fromJSON(original, { reuseExistingPanels: true });
          for (const position of created) {
            const edge = api.getEdgeGroup(position);
            if (edge && !api.panels.some((panel) => panel.group.id === edge.id)) api.removeEdgeGroup(position);
          }
        }
      }
    };
  },
  { op: 'collapseAuxiliaryPanels' }
);

export type AuxiliaryPanelLayout = ReturnType<typeof collapseAuxiliaryPanels>;
