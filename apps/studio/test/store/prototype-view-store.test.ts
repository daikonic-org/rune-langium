// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, expect, it, vi } from 'vitest';

const { mockReadWorkbenchSettings, mockWriteWorkbenchSettings } = vi.hoisted(() => ({
  mockReadWorkbenchSettings: vi.fn(),
  mockWriteWorkbenchSettings: vi.fn()
}));

vi.mock('../../src/shell/workbench-settings.js', () => ({
  readWorkbenchSettings: mockReadWorkbenchSettings,
  writeWorkbenchSettings: mockWriteWorkbenchSettings
}));

import { DEFAULT_PROTOTYPE_VIEW, usePrototypeViewStore } from '../../src/store/prototype-view-store.js';

afterEach(() => {
  mockReadWorkbenchSettings.mockReset();
  mockWriteWorkbenchSettings.mockReset();
  usePrototypeViewStore.setState({ workspaceId: null, state: DEFAULT_PROTOTYPE_VIEW });
});

it('keeps local prototype edits when they occur during activation', async () => {
  let restore!: (value: typeof DEFAULT_PROTOTYPE_VIEW) => void;
  mockReadWorkbenchSettings.mockImplementation(
    () => new Promise<typeof DEFAULT_PROTOTYPE_VIEW>((resolve) => (restore = resolve))
  );

  const activating = usePrototypeViewStore.getState().activate('workspace-a');
  usePrototypeViewStore.getState().patch({ query: 'local query' });
  restore({ ...DEFAULT_PROTOTYPE_VIEW, query: 'restored query', typeFqn: 'test.Party' });
  await activating;

  expect(usePrototypeViewStore.getState().state).toMatchObject({ query: 'local query', typeFqn: null });
});

it('rejects corrupt or unbounded persisted workflow widths', async () => {
  const { normalizeWorkflowWidths } = await import('../../src/store/prototype-view-store.js');
  for (const input of [null, [], [0, 99], [NaN, 28], [40, 40], ['32', 28]])
    expect(normalizeWorkflowWidths(input)).toEqual([32, 28]);
  expect(normalizeWorkflowWidths([30, 30])).toEqual([30, 30]);
});
