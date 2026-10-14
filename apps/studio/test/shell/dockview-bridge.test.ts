// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * dockview-bridge — pins the layout-shape → dockview-API conversion.
 * Real dockview can't run in jsdom; this exercises the bridge against a
 * spy-API that records every call so we can assert the addPanel ordering,
 * group inheritance, and active-panel selection.
 */

import { describe, it, expect, vi } from 'vitest';
import { applyLayout, isFactoryShape, serializeLayout } from '../../src/shell/dockview-bridge.js';
import { buildDefaultLayout } from '../../src/shell/layout-factory.js';
import { useOutputStore } from '../../src/store/output-store.js';

interface FakeGroupSpy {
  api: {
    setSize: (s: { width?: number; height?: number }) => void;
    setConstraints: (c: {
      minimumHeight?: number;
      minimumWidth?: number;
      maximumHeight?: number;
      maximumWidth?: number;
    }) => void;
  };
  sizeCalls: Array<{ width?: number; height?: number }>;
  constraintCalls: Array<{
    minimumHeight?: number;
    minimumWidth?: number;
    maximumHeight?: number;
    maximumWidth?: number;
  }>;
  /** Records call order across both setSize and setConstraints for sequencing assertions. */
  callOrder: Array<'setSize' | 'setConstraints'>;
}

function makeFakeGroup(): FakeGroupSpy {
  const spy: FakeGroupSpy = {
    sizeCalls: [],
    constraintCalls: [],
    callOrder: [],
    api: {
      setSize: (s) => {
        spy.sizeCalls.push(s);
        spy.callOrder.push('setSize');
      },
      setConstraints: (c) => {
        spy.constraintCalls.push(c);
        spy.callOrder.push('setConstraints');
      }
    }
  };
  return spy;
}

class FakeDockviewApi {
  calls: Array<{
    id: string;
    component: string;
    title?: string;
    initialWidth?: number;
    position?: { referencePanel?: string; referenceGroup?: unknown; direction?: string };
  }> = [];
  activatedPanels: string[] = [];
  fromJSONCalls = 0;
  groups = new Map<string, FakeGroupSpy>();

  addPanel(opts: {
    id: string;
    component: string;
    title?: string;
    initialWidth?: number;
    position?: { referencePanel?: string; referenceGroup?: unknown; direction?: string };
  }) {
    this.calls.push(opts);
    const group = makeFakeGroup();
    this.groups.set(opts.id, group);
    return {
      id: opts.id,
      api: { setActive: () => this.activatedPanels.push(opts.id) },
      group
    };
  }
  getPanel(id: string) {
    if (!this.calls.some((c) => c.id === id)) return undefined;
    return { api: { setActive: () => this.activatedPanels.push(id) }, group: this.groups.get(id) };
  }
  get panels() {
    return this.calls.map((call) => ({
      api: { component: call.component }
    }));
  }
  fromJSON() {
    this.fromJSONCalls++;
  }
  clear() {
    this.calls = [];
  }
  toJSON() {
    return { panels: this.calls.map((c) => c.id) };
  }
}

describe('isFactoryShape', () => {
  it('returns true for a freshly built layout', () => {
    const layout = buildDefaultLayout({ studioVersion: '0.1.0', viewportWidth: 1920 });
    expect(isFactoryShape(layout.dockview)).toBe(true);
  });

  it('returns false for a native serialized layout', () => {
    expect(isFactoryShape({ shape: 'native', json: { panels: ['workspace.editor'] } })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isFactoryShape(null)).toBe(false);
  });
});

describe('applyLayout — factory shape', () => {
  it('issues addPanel calls in column order, then bottom-group tabs', () => {
    const layout = buildDefaultLayout({ studioVersion: '0.1.0', viewportWidth: 1920 });
    const api = new FakeDockviewApi();
    applyLayout(api as never, layout);
    const ids = api.calls.map((c) => c.id);
    // Center column is now a single-tab group (source and inspector render inside CenterStackPanel).
    // First two are fileTree + visualPreview; remaining calls include preview + bottom tabs.
    expect(ids.slice(0, 2)).toEqual(['workspace.fileTree', 'workspace.visualPreview']);
    expect(ids.slice(2)).toEqual(
      expect.arrayContaining(['workspace.problems', 'workspace.activity', 'workspace.output', 'workspace.formPreview'])
    );
    // workspace.editor and workspace.inspector are NOT added as dockview panels
    expect(ids).not.toContain('workspace.editor');
    expect(ids).not.toContain('workspace.inspector');
  });

  it('passes user-facing PANEL_TITLES on every addPanel call (FR-008)', () => {
    const layout = buildDefaultLayout({ studioVersion: '0.1.0', viewportWidth: 1920 });
    const api = new FakeDockviewApi();
    applyLayout(api as never, layout);
    const titleById = new Map(api.calls.map((c) => [c.id, c.title]));
    expect(titleById.get('workspace.fileTree')).toBe('Type explorer');
    expect(titleById.get('workspace.problems')).toBe('Problems');
    expect(titleById.get('workspace.output')).toBe('Output');
    expect(titleById.get('workspace.activity')).toBe('Activity');
    expect(titleById.get('workspace.visualPreview')).toBe('Graph');
    expect(titleById.get('workspace.formPreview')).toBe('Form');
    expect(titleById.get('workspace.codePreview')).toBe('Code');
    // Every call must carry a title — no internal workspace.* leaks.
    for (const call of api.calls) {
      expect(call.title).toBeTruthy();
      expect(call.title).not.toMatch(/^workspace\./);
    }
  });
  it('positions each subsequent column to the right of the previous', () => {
    const layout = buildDefaultLayout({ studioVersion: '0.1.0', viewportWidth: 1920 });
    const api = new FakeDockviewApi();
    applyLayout(api as never, layout);
    // Column 0: fileTree is a single panel (no position / undefined direction for first panel)
    const fileTree = api.calls.find((c) => c.id === 'workspace.fileTree');
    expect(fileTree?.position).toBeUndefined();
    // Column 1: visualPreview is the only tab in the center group, positioned right of fileTree
    const visualize = api.calls.find((c) => c.id === 'workspace.visualPreview');
    expect(visualize?.position?.direction).toBe('right');
    expect(visualize?.position?.referencePanel).toBe('workspace.fileTree');
    // Column 2: formPreview is first tab in the right group, positioned right of visualPreview
    const preview = api.calls.find((c) => c.id === 'workspace.formPreview');
    expect(preview?.position?.direction).toBe('right');
    expect(preview?.position?.referencePanel).toBe('workspace.visualPreview');
  });

  it('positions the first bottom tab below the editor and the rest within the same group', () => {
    const layout = buildDefaultLayout({ studioVersion: '0.1.0', viewportWidth: 1920 });
    const api = new FakeDockviewApi();
    applyLayout(api as never, layout);
    const bottomCalls = api.calls.filter((c) =>
      ['workspace.problems', 'workspace.activity', 'workspace.output'].includes(c.id)
    );
    expect(bottomCalls[0]?.position?.direction).toBe('below');
    expect(bottomCalls[1]?.position?.direction).toBe('within');
  });

  it('activates the configured default bottom tab', () => {
    const layout = buildDefaultLayout({ studioVersion: '0.1.0', viewportWidth: 1920 });
    const api = new FakeDockviewApi();
    applyLayout(api as never, layout);
    expect(api.activatedPanels).toContain('workspace.problems');
  });

  it('constrains the bottom group minimum height so collapse can reach the header height', () => {
    const layout = buildDefaultLayout({ studioVersion: '0.1.0', viewportWidth: 1920 });
    const api = new FakeDockviewApi();
    applyLayout(api as never, layout);
    const bottomGroup = api.groups.get('workspace.problems');
    expect(bottomGroup?.constraintCalls).toContainEqual({ minimumHeight: 42 });
  });

  it('sets the minimum-height constraint before any collapse setSize call', () => {
    const layout = buildDefaultLayout({ studioVersion: '0.1.0', viewportWidth: 1920 });
    const factoryDockview = layout.dockview as Extract<typeof layout.dockview, { shape: 'factory' }>;
    layout.dockview = {
      ...factoryDockview,
      bottomGroup: { ...factoryDockview.bottomGroup, collapsed: true }
    };
    const api = new FakeDockviewApi();
    applyLayout(api as never, layout);
    const bottomGroup = api.groups.get('workspace.problems');
    expect(bottomGroup?.constraintCalls).toContainEqual({ minimumHeight: 42 });
    expect(bottomGroup?.sizeCalls).toContainEqual({ height: 0 });
    // setConstraints must fire before setSize so the height: 0 request is clamped
    // against the 42px header floor, not dockview's default 100px floor.
    expect(bottomGroup?.callOrder).toEqual(['setConstraints', 'setSize']);
  });
});

describe('applyLayout — native shape', () => {
  it('routes through api.fromJSON', () => {
    const native = {
      version: 1,
      writtenBy: '0.1.0',
      dockview: { shape: 'native' as const, json: { panels: ['workspace.editor'] } }
    };
    const api = new FakeDockviewApi();
    api.fromJSON = () => {
      api.fromJSONCalls++;
      api.calls.push({ id: 'workspace.editor', component: 'workspace.editor' });
    };
    applyLayout(api as never, native);
    expect(api.fromJSONCalls).toBe(1);
    expect(api.calls).toHaveLength(1);
  });

  it('constrains the restored bottom group minimum height so a later collapse can reach the header height', () => {
    const native = {
      version: 1,
      writtenBy: '0.1.0',
      dockview: { shape: 'native' as const, json: { panels: ['workspace.problems'] } }
    };
    const api = new FakeDockviewApi();
    api.fromJSON = () => {
      api.fromJSONCalls++;
      // Simulate dockview restoring the panel via addPanel so a tracked group exists.
      api.addPanel({ id: 'workspace.problems', component: 'workspace.problems' });
    };
    applyLayout(api as never, native);
    expect(api.fromJSONCalls).toBe(1);
    const bottomGroup = api.groups.get('workspace.problems');
    expect(bottomGroup?.constraintCalls).toContainEqual({ minimumHeight: 42 });
  });

  it('logs and falls back to factory layout when api.fromJSON throws', () => {
    useOutputStore.setState({ lines: [] });
    const native = {
      version: 1,
      writtenBy: '0.1.0',
      dockview: { shape: 'native' as const, json: { broken: true } }
    };
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const api = new FakeDockviewApi();
    api.fromJSON = () => {
      throw new Error('incompatible_layout_v3');
    };
    applyLayout(api as never, native);
    // Error was surfaced
    expect(errSpy).toHaveBeenCalledOnce();
    const arg0 = errSpy.mock.calls[0]?.[0];
    expect(String(arg0)).toContain('api.fromJSON rejected');
    expect(api.calls.length).toBeGreaterThanOrEqual(6);
    errSpy.mockRestore();

    // This path recovers internally (never rethrows), so DockShell's own
    // op-logged try/catch around applyLayout never sees it — the op-log
    // entry has to come from here, or the reset is otherwise silent.
    const entry = useOutputStore.getState().lines.find((l) => l.text.includes('saved layout rejected'));
    expect(entry).toBeDefined();
    expect(entry?.severity).toBe('warn');
  });

  it('logs and falls back when fromJSON restores zero panels', () => {
    const native = {
      version: 1,
      writtenBy: '0.1.0',
      dockview: { shape: 'native' as const, json: { grid: { root: {} }, panels: {} } }
    };
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const api = new FakeDockviewApi();
    applyLayout(api as never, native);
    expect(api.fromJSONCalls).toBe(1);
    expect(errSpy).toHaveBeenCalledOnce();
    expect(api.calls.length).toBeGreaterThanOrEqual(6);
    errSpy.mockRestore();
  });

  it('logs and falls back when fromJSON restores unknown components', () => {
    const native = {
      version: 1,
      writtenBy: '0.1.0',
      dockview: { shape: 'native' as const, json: { grid: { root: {} }, panels: { ghost: {} } } }
    };
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const api = new FakeDockviewApi();
    api.fromJSON = () => {
      api.fromJSONCalls++;
      api.calls.push({ id: 'ghost', component: 'workspace.ghost' });
    };
    applyLayout(api as never, native);
    expect(api.fromJSONCalls).toBe(1);
    expect(errSpy).toHaveBeenCalledOnce();
    expect(api.calls.length).toBeGreaterThanOrEqual(6);
    errSpy.mockRestore();
  });
});

describe('serializeLayout', () => {
  it('returns a tagged native payload', () => {
    const api = new FakeDockviewApi();
    api.addPanel({ id: 'workspace.editor', component: 'workspace.editor' });
    const out = serializeLayout(api as never);
    expect(out.shape).toBe('native');
    if (out.shape === 'native') {
      expect((out.json as { panels: string[] }).panels).toEqual(['workspace.editor']);
    }
  });
});
