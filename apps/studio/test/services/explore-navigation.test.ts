// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeNodeId, selectNodeRepository, type TypeGraphNode } from '@rune-langium/visual-editor';
import {
  resolveExploreNavigation,
  useExploreNavigationStore,
  viewTypeInExplore
} from '../../src/services/explore-navigation.js';
import { usePerspectiveStore } from '../../src/store/perspective-store.js';

describe('Explore navigation bridge', () => {
  beforeEach(() => {
    useExploreNavigationStore.setState({ navigateToType: undefined });
    usePerspectiveStore.setState({ activePerspective: 'prototype' });
  });

  it('activates Explore and delegates to its registered navigation callback', () => {
    const navigateToType = vi.fn();
    useExploreNavigationStore.getState().setNavigateToType(navigateToType);

    expect(viewTypeInExplore('test.Party')).toBe(true);
    expect(usePerspectiveStore.getState().activePerspective).toBe('explore');
    expect(navigateToType).toHaveBeenCalledWith('test.Party');
  });

  it('does not switch perspective before Explore has registered navigation', () => {
    expect(viewTypeInExplore('test.Party')).toBe(false);
    expect(usePerspectiveStore.getState().activePerspective).toBe('prototype');
  });
});

describe('Explore navigation selection resolution', () => {
  const dataId = makeNodeId('test', 'Party', 'Data');
  const functionId = makeNodeId('test', 'Party', 'RosettaFunction');
  const nodes = [
    {
      id: dataId,
      type: 'data',
      position: { x: 0, y: 0 },
      data: { $type: 'Data', name: 'Party', attributes: [], conditions: [], annotations: [] },
      meta: { namespace: 'test', errors: [], hasExternalRefs: false }
    },
    {
      id: functionId,
      type: 'func',
      position: { x: 0, y: 0 },
      data: { $type: 'RosettaFunction', name: 'Party', inputs: [], conditions: [], annotations: [] },
      meta: { namespace: 'test', errors: [], hasExternalRefs: false }
    }
  ] as TypeGraphNode[];
  const repository = selectNodeRepository(new Map(nodes.map((node) => [node.id, node])));

  it('ignores Source cursor synchronization to the selected type after resolving its qualified name', () => {
    const request = resolveExploreNavigation(repository, 'test.Party', dataId, 'source');
    expect(request.targetNode?.id).toBe(dataId);
    expect(request.unchanged).toBe(true);
    expect(resolveExploreNavigation(repository, dataId, dataId, 'source').unchanged).toBe(true);
  });

  it('preserves explicit repeat navigation from the explorer or inspector', () => {
    expect(resolveExploreNavigation(repository, dataId, dataId).unchanged).toBe(false);
  });

  it('navigates when Source selects another declaration, including one with the same name', () => {
    const request = resolveExploreNavigation(repository, functionId, dataId, 'source');
    expect(request.targetNode?.id).toBe(functionId);
    expect(request.unchanged).toBe(false);
    expect(resolveExploreNavigation(repository, 'test.Party', functionId, 'source').unchanged).toBe(false);
    expect(resolveExploreNavigation(repository, 'test.Party', undefined, 'source').unchanged).toBe(false);
  });

  it('leaves unavailable declarations unresolved for the existing missing-type feedback', () => {
    const request = resolveExploreNavigation(repository, 'test.Missing', dataId, 'source');
    expect(request.targetNode).toBeUndefined();
    expect(request.unchanged).toBe(false);
  });
});
