// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DockviewApi } from 'dockview-react';
import { WorkbenchHost } from '../../src/shell/WorkbenchHost.js';
import { useDesignPreviewStore } from '../../src/store/design-preview-store.js';
import { EXPLORE_PREVIEW_WIDTH } from '../../src/shell/layout-factory.js';

afterEach(() => useDesignPreviewStore.getState().reset());

it.each([false, true])('provides explicit side-panel toggles with edge preview=%s', async (preview) => {
  let ready: DockviewApi;
  const user = userEvent.setup();
  useDesignPreviewStore.getState().setPreference('auxiliary', preview);
  const { unmount } = render(
    <WorkbenchHost
      definition={{
        id: 'explore',
        panels: {
          'workspace.visualPreview': () => <div>Model</div>,
          'workspace.fileTree': () => <div>Types</div>,
          'workspace.formPreview': () => <input aria-label="Preview draft" defaultValue="unfinished" />,
          'workspace.codePreview': () => <input aria-label="Code draft" defaultValue="generated" />
        },
        titles: {},
        buildDefault(api) {
          const model = api.addPanel({ id: 'model', component: 'workspace.visualPreview' });
          api.addPanel({
            id: 'types',
            component: 'workspace.fileTree',
            position: { referencePanel: model.id, direction: 'left' }
          });
          api.addPanel({
            id: 'form',
            component: 'workspace.formPreview',
            position: { referencePanel: model.id, direction: 'right' }
          });
          api.addPanel({
            id: 'code',
            component: 'workspace.codePreview',
            position: { referencePanel: 'form', direction: 'right' }
          });
        }
      }}
      onReady={(api) => {
        ready = api;
        api.layout(1280, 720);
      }}
      onNativeLayoutChange={() => {}}
    />
  );
  await waitFor(() => expect(screen.getByRole('button', { name: 'Hide Type explorer' })).toBeInTheDocument());
  const types = ready!.getPanel('types')!;
  const form = ready!.getPanel('form')!;
  const code = ready!.getPanel('code')!;
  expect(code.group).toBe(form.group);
  await waitFor(() => expect(form.group.api.width).toBe(EXPLORE_PREVIEW_WIDTH));
  expect(screen.getAllByRole('button', { name: 'Hide Preview panel' })).toHaveLength(1);
  expect(screen.getByRole('tab', { name: 'Type explorer' })).toBeInTheDocument();
  expect(types.group.element).toHaveClass('studio-side-panel');
  expect(types.group.api.getHeaderPosition()).toBe('top');
  const originalWidth = types.group.api.width;
  await user.click(screen.getByRole('tab', { name: 'Form' }));
  expect(form.group.activePanel?.id).toBe('form');
  const draft = screen.getByRole('textbox', { name: 'Preview draft' });
  fireEvent.change(draft, { target: { value: 'unfinished value' } });
  await user.click(screen.getByRole('button', { name: 'Hide Type explorer' }));
  expect(types.group.api.getHeaderPosition()).toBe('left');
  expect(screen.getByRole('button', { name: 'Show Type explorer' })).toHaveAttribute('aria-expanded', 'false');
  await user.click(screen.getByRole('button', { name: 'Hide Preview panel' }));
  expect(screen.getByRole('tab', { name: 'Form Preview' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Code Preview' })).toBeInTheDocument();
  expect(form.group.api.getHeaderPosition()).toBe('right');
  act(() => ready!.layout(1600, 720));
  expect(screen.getByRole('button', { name: 'Show Type explorer' })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByRole('button', { name: 'Show Preview panel' })).toHaveAttribute('aria-expanded', 'false');
  await user.click(screen.getByRole('button', { name: 'Show Type explorer' }));
  expect(types.group.api.getHeaderPosition()).toBe('top');
  expect(screen.getByRole('button', { name: 'Hide Type explorer' })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('button', { name: 'Show Preview panel' })).toHaveAttribute('aria-expanded', 'false');
  expect(types.group.api.width).toBe(originalWidth);
  act(() => ready!.getPanel('model')!.api.setActive());
  expect(screen.getByRole('button', { name: 'Hide Type explorer' })).toHaveAttribute('aria-expanded', 'true');
  await user.click(screen.getByRole('button', { name: 'Show Preview panel' }));
  expect(form.group.api.getHeaderPosition()).toBe('top');
  expect(screen.getByRole('tab', { name: 'Code' })).toBeInTheDocument();
  await user.click(screen.getByRole('tab', { name: 'Form' }));
  expect(screen.getByRole('button', { name: 'Hide Preview panel' })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('textbox', { name: 'Preview draft' })).toBe(draft);
  expect(draft).toHaveValue('unfinished value');
  expect(ready!.getPanel('form')).toBe(form);
  await user.click(screen.getByRole('tab', { name: 'Code' }));
  const codeDraft = screen.getByRole('textbox', { name: 'Code draft' });
  fireEvent.change(codeDraft, { target: { value: 'generated value' } });
  expect(codeDraft).toHaveValue('generated value');
  await user.click(screen.getByRole('button', { name: 'Hide Preview panel' }));
  expect(screen.getAllByRole('button', { name: 'Show Preview panel' })).toHaveLength(1);
  await user.click(screen.getByRole('button', { name: 'Show Preview panel' }));
  expect(screen.getByRole('textbox', { name: 'Code draft' })).toBe(codeDraft);
  expect(codeDraft).toHaveValue('generated value');
  if (!preview) {
    await user.click(screen.getByRole('button', { name: 'Hide Type explorer' }));
    act(() =>
      ready!.addPanel({
        id: 'shared-model',
        component: 'workspace.visualPreview',
        position: { referencePanel: 'types', direction: 'within' }
      })
    );
    expect(screen.queryByRole('button', { name: 'Show Type explorer' })).not.toBeInTheDocument();
    expect(types.group.api.width).toBeGreaterThan(52);
    expect(types.group.element).not.toHaveClass('studio-side-panel');
    expect(types.group.api.getHeaderPosition()).toBe('top');
  }
  unmount();
});

it('does not hide a mobile tab group shared with the main task', () => {
  const { unmount } = render(
    <WorkbenchHost
      definition={{
        id: 'explore',
        titles: {},
        panels: { 'workspace.visualPreview': () => null, 'workspace.fileTree': () => null },
        buildDefault(api) {
          const model = api.addPanel({ id: 'model', component: 'workspace.visualPreview' });
          api.addPanel({
            id: 'types',
            component: 'workspace.fileTree',
            position: { referencePanel: model.id, direction: 'within' }
          });
        }
      }}
      onReady={(api) => api.layout(600, 720)}
      onNativeLayoutChange={() => {}}
    />
  );
  expect(screen.queryByRole('button', { name: 'Hide Type explorer' })).not.toBeInTheDocument();
  unmount();
});

it('does not persist automatic collapse when another dock group is resized', async () => {
  let api: DockviewApi | undefined;
  const originalBounds = HTMLElement.prototype.getBoundingClientRect;
  const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const model = api?.getPanel('model')?.group;
    const form = api?.getPanel('form')?.group;
    const left = api?.getPanel('types')?.group.api.width ?? 0;
    if (this.dataset.testid === 'center-stack') return new DOMRect(left, 0, model?.api.width ?? 0, 700);
    if (this === form?.element) return new DOMRect(left + (model?.api.width ?? 0), 0, form.api.width, 700);
    return originalBounds.call(this);
  });
  const saved = vi.fn();
  const definition = {
    id: 'explore' as const,
    titles: {},
    panels: {
      'workspace.visualPreview': () => (
        <div data-testid="center-stack" data-count="3">
          Model
        </div>
      ),
      'workspace.fileTree': () => <div>Types</div>,
      'workspace.formPreview': () => <input aria-label="Draft" defaultValue="retained" />
    },
    buildDefault(ready: DockviewApi) {
      const model = ready.addPanel({ id: 'model', component: 'workspace.visualPreview' });
      ready.addPanel({
        id: 'types',
        component: 'workspace.fileTree',
        position: { referencePanel: model.id, direction: 'left' }
      });
      ready.addPanel({
        id: 'form',
        component: 'workspace.formPreview',
        position: { referencePanel: model.id, direction: 'right' }
      });
    }
  };
  try {
    const first = render(
      <WorkbenchHost
        definition={definition}
        onNativeLayoutChange={saved}
        onReady={(ready) => {
          api = ready;
          ready.layout(1280, 720);
          ready.getPanel('types')!.group.api.setSize({ width: 240 });
        }}
      />
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show Preview panel' })).toBeInTheDocument());
    saved.mockClear();
    act(() => api!.getPanel('types')!.group.api.setSize({ width: 270 }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    const json = saved.mock.lastCall![0];
    const find = (node: { data: unknown; size?: number }): number | undefined =>
      Array.isArray(node.data)
        ? node.data.map(find).find((size) => size !== undefined)
        : (node.data as { id?: string }).id === api!.getPanel('form')!.group.id
          ? node.size
          : undefined;
    expect(find(json.grid.root)).toBe(52);
    expect(json.studioAutomaticPreviewWidths[api!.getPanel('form')!.group.id]).toBe(320);
    first.unmount();
    const second = render(
      <WorkbenchHost
        definition={definition}
        initialNativeLayout={json}
        onNativeLayoutChange={saved}
        onReady={(ready) => {
          api = ready;
          ready.layout(2560, 720);
        }}
      />
    );
    await waitFor(() => expect(api!.getPanel('form')!.group.api.width).toBe(320));
    expect(api!.getPanel('model')!.group.api.width).toBeGreaterThanOrEqual(900);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Hide Preview panel' })).toBeInTheDocument());
    second.unmount();
  } finally {
    bounds.mockRestore();
  }
});
