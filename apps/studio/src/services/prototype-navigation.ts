// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { create } from 'zustand';
import { viewTypeInExplore } from './explore-navigation.js';
import type { InstanceSeed } from '../components/InstanceCreateDialog.js';
import { usePerspectiveStore } from '../store/perspective-store.js';
import { withInstrumentation } from './instrumentation/core.js';

export type PrototypeIntent = { kind: 'create'; seed: InstanceSeed } | { kind: 'open'; instanceId: string };
interface StoredIntent {
  workspaceId: string | null;
  intent: PrototypeIntent;
}
interface PrototypeNavigationState {
  pending: StoredIntent | null;
  returnScope: string | null;
  request(workspaceId: string, intent: PrototypeIntent): void;
  consume(workspaceId: string): PrototypeIntent | null;
}

export const usePrototypeNavigationStore = create<PrototypeNavigationState>((set, get) => ({
  pending: null,
  returnScope: null,
  request(workspaceId, intent) {
    set({ pending: { workspaceId, intent: structuredClone(intent) }, returnScope: null });
    usePerspectiveStore.getState().setActivePerspective('prototype');
  },
  consume(workspaceId) {
    const pending = get().pending;
    if (!pending || pending.workspaceId !== workspaceId) return null;
    set({ pending: null });
    return pending.intent;
  }
}));

export const requestPrototype = withInstrumentation(
  function requestPrototype(workspaceId: string, intent: PrototypeIntent): void {
    usePrototypeNavigationStore.getState().request(workspaceId, intent);
  },
  { op: 'requestPrototype' }
);

/** Navigation carries workspace lifetime, never workflow values or a new instance intent. */
export const prototypeReturnScope = withInstrumentation(
  function prototypeReturnScope(workspaceId: string, workspaceEpoch?: number): string {
    return JSON.stringify([workspaceId, workspaceEpoch]);
  },
  { op: 'prototypeReturnScope', capture: 0 }
);

export const viewPrototypeType = withInstrumentation(
  function viewPrototypeType(workspaceId: string, workspaceEpoch: number | undefined, nodeId: string): boolean {
    if (!viewTypeInExplore(nodeId)) return false;
    usePrototypeNavigationStore.setState({ returnScope: prototypeReturnScope(workspaceId, workspaceEpoch) });
    return true;
  },
  { op: 'viewPrototypeType', capture: 0 }
);

export const returnToPrototype = withInstrumentation(
  function returnToPrototype(scope: string): void {
    if (usePrototypeNavigationStore.getState().returnScope !== scope) return;
    usePrototypeNavigationStore.setState({ returnScope: null });
    usePerspectiveStore.getState().setActivePerspective('prototype');
  },
  { op: 'returnToPrototype', capture: 0 }
);
