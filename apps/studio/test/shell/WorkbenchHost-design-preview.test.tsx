// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import { createDockview, type DockviewApi, type DockviewReadyEvent } from 'dockview-react';
import { useDesignPreviewStore } from '../../src/store/design-preview-store.js';

vi.mock('@rune-langium/design-system/ui/dock-layout', () => ({
  DockLayout({ onReady }: { onReady(event: DockviewReadyEvent): void }) {
    const element = useRef<HTMLDivElement>(null);
    useEffect(() => {
      const api = createDockview(element.current!, {
        createComponent: () => ({ element: document.createElement('div'), init() {} })
      });
      api.layout(1280, 720);
      onReady({ api });
      return () => api.dispose();
    }, [onReady]);
    return <div ref={element} />;
  }
}));

import { WorkbenchHost } from '../../src/shell/WorkbenchHost.js';

afterEach(() => useDesignPreviewStore.getState().reset());

describe('workbench design comparison', () => {
  it('suppresses persistence during comparison and restores the same panel instances', async () => {
    let api: DockviewApi | undefined;
    const save = vi.fn();
    const { unmount } = render(
      <WorkbenchHost
        definition={{
          id: 'explore',
          panels: { 'workspace.visualPreview': () => null, 'workspace.formPreview': () => null },
          titles: {},
          buildDefault(api) {
            const model = api.addPanel({ id: 'model', component: 'workspace.visualPreview' });
            api.addPanel({
              id: 'form',
              component: 'workspace.formPreview',
              position: { referencePanel: model.id, direction: 'right' }
            });
          }
        }}
        onReady={(ready) => {
          api = ready;
        }}
        onNativeLayoutChange={save}
      />
    );
    const ready = api!;
    const form = ready.getPanel('form')!;
    save.mockClear();
    act(() => useDesignPreviewStore.getState().setPreference('auxiliary', true));
    const edge = ready.getEdgeGroup('right')!;
    expect(edge.isCollapsed()).toBe(true);
    const changed = new Promise<void>((resolve) => {
      const listener = ready.onDidLayoutChange(() => {
        listener.dispose();
        resolve();
      });
    });
    act(() => form.api.setActive());
    await changed;
    expect(save).not.toHaveBeenCalled();
    act(() => useDesignPreviewStore.getState().reset());
    expect(ready.getPanel('form')).toBe(form);
    expect(form.api.location.type).toBe('grid');
    expect(ready.getEdgeGroup('right') === undefined).toBe(true);
    // Teardown with comparison active must not restore into a disposed host.
    act(() => useDesignPreviewStore.getState().setPreference('auxiliary', true));
    expect(() => unmount()).not.toThrow();
  });
});
