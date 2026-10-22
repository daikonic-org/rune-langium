// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { create } from 'zustand';
import type { InstanceRecord } from '@rune-langium/codegen/instances';
import { readWorkbenchSettings, writeWorkbenchSettings } from '../shell/workbench-settings.js';
import { withInstrumentation } from '../services/instrumentation/core.js';
import { createActivationGuard } from './activation-guard.js';

export interface PrototypeViewState {
  selectedId: string | null;
  query: string;
  typeFqn: string | null;
  nativeLayout?: unknown;

  graphVisible: boolean;
}

export const DEFAULT_PROTOTYPE_VIEW: PrototypeViewState = {
  selectedId: null,
  query: '',
  typeFqn: null,

  graphVisible: false
};

export const filterInstances = withInstrumentation(
  function filterInstances(
    records: readonly InstanceRecord[],
    query: string,
    typeFqn: string | null
  ): InstanceRecord[] {
    const needle = query.trim().toLocaleLowerCase();
    return records.filter(
      (record) =>
        (!typeFqn || record.typeFqn === typeFqn) &&
        `${record.name} ${record.typeFqn}`.toLocaleLowerCase().includes(needle)
    );
  },
  { op: 'filterInstances' }
);

interface PrototypeViewStore {
  workspaceId: string | null;
  state: PrototypeViewState;
  activate(workspaceId: string): Promise<void>;
  patch(patch: Partial<PrototypeViewState>): void;
}

const activation = createActivationGuard();

export const usePrototypeViewStore = create<PrototypeViewStore>((set, get) => ({
  workspaceId: null,
  state: DEFAULT_PROTOTYPE_VIEW,
  async activate(workspaceId) {
    const generation = activation.begin();
    set({ workspaceId, state: DEFAULT_PROTOTYPE_VIEW });
    const restored = await readWorkbenchSettings(workspaceId, 'prototype-view', DEFAULT_PROTOTYPE_VIEW);
    if (activation.isCurrent(generation) && get().workspaceId === workspaceId) {
      set({ state: { ...DEFAULT_PROTOTYPE_VIEW, ...restored } });
    }
  },
  patch(patch) {
    activation.invalidate();
    const workspaceId = get().workspaceId;
    const state = { ...get().state, ...patch };
    set({ state });
    if (workspaceId) void writeWorkbenchSettings(workspaceId, 'prototype-view', state);
  }
}));
