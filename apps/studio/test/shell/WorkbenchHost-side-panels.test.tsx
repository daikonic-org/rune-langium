// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, expect, it } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DockviewApi } from 'dockview-react';
import { WorkbenchHost } from '../../src/shell/WorkbenchHost.js';
import { useDesignPreviewStore } from '../../src/store/design-preview-store.js';

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
          'workspace.formPreview': () => <input aria-label="Preview draft" defaultValue="unfinished" />
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
  const originalWidth = types.group.api.width;
  const draft = screen.getByRole('textbox', { name: 'Preview draft' });
  await user.type(draft, ' value');
  await user.click(screen.getByRole('button', { name: 'Hide Type explorer' }));
  expect(screen.getByRole('button', { name: 'Show Type explorer' })).toHaveAttribute('aria-expanded', 'false');
  await user.click(screen.getByRole('button', { name: 'Hide Preview panel' }));
  act(() => ready!.layout(1600, 720));
  expect(screen.getByRole('button', { name: 'Show Type explorer' })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByRole('button', { name: 'Show Preview panel' })).toHaveAttribute('aria-expanded', 'false');
  await user.click(screen.getByRole('button', { name: 'Show Type explorer' }));
  expect(screen.getByRole('button', { name: 'Hide Type explorer' })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('button', { name: 'Show Preview panel' })).toHaveAttribute('aria-expanded', 'false');
  expect(types.group.api.width).toBe(originalWidth);
  act(() => ready!.getPanel('model')!.api.setActive());
  expect(screen.getByRole('button', { name: 'Hide Type explorer' })).toHaveAttribute('aria-expanded', 'true');
  await user.click(screen.getByRole('button', { name: 'Show Preview panel' }));
  await user.click(screen.getByRole('tab', { name: 'form' }));
  expect(screen.getByRole('button', { name: 'Hide Preview panel' })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('textbox', { name: 'Preview draft' })).toBe(draft);
  expect(draft).toHaveValue('unfinished value');
  expect(ready!.getPanel('form')).toBe(form);
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
