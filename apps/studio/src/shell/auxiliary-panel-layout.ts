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

/** Use native edge-group collapse/expand; no enterprise peek-module dependency. */
export const collapseAuxiliaryPanels = withInstrumentation(
  function collapseAuxiliaryPanels(api: DockviewApi, perspective: WorkbenchDefinition['id']) {
    const original = api.toJSON();
    const pinned = new Set<string>();
    const managed = new Set<string>();
    const created = new Set<EdgeGroupPosition>();
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
        edge.setHeaderPosition(position === 'bottom' ? 'top' : position);
      }
      if (!edge.isCollapsed()) pinned.add(edge.id);
      managed.add(edge.id);
      for (const panel of panels) panel.api.moveTo({ group, position: 'center', skipSetActive: true });
    }

    const listener = api.onDidActiveGroupChange((active) => {
      for (const position of ['left', 'right', 'bottom'] as const) {
        const edge = api.getEdgeGroup(position);
        if (!edge || !managed.has(edge.id)) continue;
        if (edge.id === active?.id || pinned.has(edge.id)) edge.expand();
        else edge.collapse();
      }
    });

    return {
      isManaged: (id: string) => managed.has(id),
      isPinned: (id: string) => pinned.has(id),
      togglePin(id: string) {
        const group = api.groups.find((candidate) => candidate.id === id);
        if (!group || !managed.has(id)) return;
        if (pinned.has(id)) {
          pinned.delete(id);
          group.api.collapse();
          api.panels.find((panel) => panel.api.location.type === 'grid')?.api.setActive();
        } else {
          pinned.add(id);
          group.api.expand();
        }
      },
      dispose(restore = true) {
        listener.dispose();
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
