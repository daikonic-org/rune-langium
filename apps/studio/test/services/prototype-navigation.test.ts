// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/shell/workbench-settings.js', () => ({
  readWorkbenchSettings: vi.fn(async (_workspaceId: string, _key: string, fallback: unknown) => fallback),
  writeWorkbenchSettings: vi.fn(async () => undefined)
}));
import { requestPrototype, usePrototypeNavigationStore } from '../../src/services/prototype-navigation.js';
import { usePerspectiveStore } from '../../src/store/perspective-store.js';
import { usePrototypeViewStore } from '../../src/store/prototype-view-store.js';
import { useInstanceStore } from '../../src/store/instance-store.js';

describe('prototype navigation', () => {
  beforeEach(() => {
    useInstanceStore.setState({ instances: {}, saveStates: {}, recordRevisions: {} });
    usePrototypeViewStore.setState({
      workspaceId: 'one',
      state: {
        selectedId: null,
        query: '',
        typeFqn: null,

        graphVisible: false
      }
    });
    usePrototypeNavigationStore.setState({ pending: null });
  });

  it('queues an existing instance without creating a duplicate', () => {
    const existingId = useInstanceStore.getState().createInstance('test.Party', 'Existing');
    const before = Object.keys(useInstanceStore.getState().instances).length;
    requestPrototype('one', { kind: 'open', instanceId: existingId });

    expect(Object.keys(useInstanceStore.getState().instances)).toHaveLength(before);
    expect(usePerspectiveStore.getState().activePerspective).toBe('prototype');
    expect(usePrototypeNavigationStore.getState().consume('one')).toEqual({ kind: 'open', instanceId: existingId });
  });

  it('does not consume a create intent after a workspace switch', () => {
    usePrototypeViewStore.setState({ workspaceId: 'stale' });
    requestPrototype('one', { kind: 'create', seed: { typeFqn: 'test.Party', data: { name: 'Alice' } } });
    expect(usePrototypeNavigationStore.getState().consume('two')).toBeNull();
    expect(usePrototypeNavigationStore.getState().consume('one')).toMatchObject({ kind: 'create' });
  });
});
