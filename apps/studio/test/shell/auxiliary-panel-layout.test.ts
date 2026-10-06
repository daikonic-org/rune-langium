// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, describe, expect, it } from 'vitest';
import { createDockview, type DockviewApi } from 'dockview-react';
import { collapseAuxiliaryPanels } from '../../src/shell/auxiliary-panel-layout.js';

let api: DockviewApi;
afterEach(() => api?.dispose());

function createWorkbench() {
  const element = document.createElement('div');
  api = createDockview(element, { createComponent: () => ({ element: document.createElement('div'), init() {} }) });
  api.layout(1280, 720);
  return api;
}

describe('auxiliary edge panels', () => {
  it('preserves a manually sized and pinned edge arrangement', () => {
    const api = createWorkbench();
    const model = api.addPanel({ id: 'model', component: 'workspace.visualPreview' });
    const form = api.addPanel({ id: 'form', component: 'workspace.formPreview' });
    const manual = api.addEdgeGroup('right', { id: 'manual', initialSize: 370, minimumSize: 300 });
    const group = api.groups.find((candidate) => candidate.id === manual.id)!;
    form.api.moveTo({ group, position: 'center' });
    const width = manual.width;
    const controller = collapseAuxiliaryPanels(api, 'explore');
    model.api.setActive();
    expect(manual.isCollapsed()).toBe(false);
    expect(manual.width).toBe(width);
    controller.dispose();
    expect(api.getPanel('form')).toBe(form);
    expect(form.group.id).toBe('manual');
    expect(api.getEdgeGroup('right')?.width).toBe(width);
  });

  it('does not collapse a manually arranged edge that contains the main task', () => {
    const api = createWorkbench();
    const model = api.addPanel({ id: 'model', component: 'workspace.visualPreview' });
    const edge = api.addEdgeGroup('right', { id: 'main-edge', initialSize: 500 });
    const group = api.groups.find((candidate) => candidate.id === edge.id)!;
    model.api.moveTo({ group, position: 'center' });
    const controller = collapseAuxiliaryPanels(api, 'explore');
    expect(controller.isManaged(edge.id)).toBe(false);
    expect(edge.isCollapsed()).toBe(false);
    controller.dispose();
  });

  it('keeps the model in the grid and opens/pins native auxiliary edges', () => {
    const api = createWorkbench();
    const model = api.addPanel({ id: 'model', component: 'workspace.visualPreview' });
    const form = api.addPanel({
      id: 'form',
      component: 'workspace.formPreview',
      position: { referencePanel: model.id, direction: 'right' }
    });
    const originalGroup = form.group.id;
    const controller = collapseAuxiliaryPanels(api, 'explore');
    const edge = api.getEdgeGroup('right')!;
    expect(model.api.location.type).toBe('grid');
    expect(form.api.location).toEqual({ type: 'edge', position: 'right' });
    expect(controller.isPinned(edge.id)).toBe(true);
    expect(edge.isCollapsed()).toBe(false);
    model.api.setActive();
    expect(edge.isCollapsed()).toBe(false);
    controller.togglePin(edge.id);
    expect(edge.isCollapsed()).toBe(true);
    form.api.setActive();
    expect(edge.isCollapsed()).toBe(false);
    model.api.setActive();
    expect(edge.isCollapsed()).toBe(true);
    controller.togglePin(edge.id);
    expect(controller.isPinned(edge.id)).toBe(true);
    model.api.setActive();
    expect(edge.isCollapsed()).toBe(false);
    controller.dispose();
    expect(api.getPanel('form')).toBe(form);
    expect(form.group.id).toBe(originalGroup);
    expect(api.getEdgeGroup('right')).toBeUndefined();
  });

  it.each([
    ['prototype', 'prototype.inspector', 'prototype.grid', 'bottom'],
    ['export', 'export.selection', 'export.settings', 'right']
  ] as const)(
    'applies the same policy to %s while preserving the main task',
    (perspective, main, auxiliary, position) => {
      const api = createWorkbench();
      const primary = api.addPanel({ id: 'primary', component: main });
      const supporting = api.addPanel({
        id: 'supporting',
        component: auxiliary,
        position: { referencePanel: primary.id, direction: 'within' }
      });
      const controller = collapseAuxiliaryPanels(api, perspective);
      expect(primary.api.location.type).toBe('grid');
      expect(supporting.api.location).toEqual({ type: 'edge', position });
      const edge = api.getEdgeGroup(position)!;
      expect(edge.isCollapsed()).toBe(false);
      expect(controller.isPinned(edge.id)).toBe(true);
      // Moving out of a group shared with the main task must not steal its full size.
      expect(position === 'bottom' ? edge.height : edge.width).toBeLessThan(400);
      controller.dispose();
      expect(supporting.group.id).toBe(primary.group.id);
    }
  );

  it('preserves an existing unpinned, collapsed edge', () => {
    const api = createWorkbench();
    const model = api.addPanel({ id: 'model', component: 'workspace.visualPreview' });
    const form = api.addPanel({ id: 'form', component: 'workspace.formPreview' });
    const edge = api.addEdgeGroup('right', { id: 'manual', initialSize: 370, collapsed: true });
    const group = api.groups.find((candidate) => candidate.id === edge.id)!;
    form.api.moveTo({ group, position: 'center', skipSetActive: true });
    const controller = collapseAuxiliaryPanels(api, 'explore');
    model.api.setActive();
    expect(controller.isPinned(edge.id)).toBe(false);
    expect(edge.isCollapsed()).toBe(true);
    controller.dispose();
  });
});
