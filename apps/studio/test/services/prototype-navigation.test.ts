// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/shell/workbench-settings.js', () => ({
  readWorkbenchSettings: vi.fn(async (_workspaceId: string, _key: string, fallback: unknown) => fallback),
  writeWorkbenchSettings: vi.fn(async () => undefined)
}));
import {
  requestPrototype,
  usePrototypeNavigationStore,
  prototypeReturnScope,
  viewPrototypeType,
  returnToPrototype
} from '../../src/services/prototype-navigation.js';
import { useExploreNavigationStore } from '../../src/services/explore-navigation.js';
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
    usePrototypeNavigationStore.setState({ pending: null, returnScope: null });
    useExploreNavigationStore.setState({ navigateToType: undefined });
    usePerspectiveStore.setState({ activePerspective: 'prototype' });
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

  it('round-trips through Explore without creating or rebinding an input', () => {
    const navigate = vi.fn();
    useExploreNavigationStore.setState({ navigateToType: navigate });
    const scope = prototypeReturnScope('one', 7);
    expect(viewPrototypeType('one', 7, 'test.Money#Data')).toBe(true);
    expect(navigate).toHaveBeenCalledWith('test.Money#Data');
    expect(usePerspectiveStore.getState().activePerspective).toBe('explore');
    returnToPrototype(prototypeReturnScope('one', 8));
    expect(usePerspectiveStore.getState().activePerspective).toBe('explore');
    returnToPrototype(prototypeReturnScope('two', 7));
    expect(usePerspectiveStore.getState().activePerspective).toBe('explore');
    returnToPrototype(scope);
    expect(usePerspectiveStore.getState().activePerspective).toBe('prototype');
    expect(usePrototypeNavigationStore.getState()).toMatchObject({ pending: null, returnScope: null });
  });

  it('does not record a return target when Explore is unavailable', () => {
    useExploreNavigationStore.setState({ navigateToType: undefined });
    usePerspectiveStore.setState({ activePerspective: 'prototype' });
    expect(viewPrototypeType('one', 7, 'test.Money#Data')).toBe(false);
    expect(usePrototypeNavigationStore.getState().returnScope).toBeNull();
    expect(usePerspectiveStore.getState().activePerspective).toBe('prototype');
  });
});
