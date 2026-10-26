// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { create } from 'zustand';
import type { InstanceRecord } from '@rune-langium/codegen/instances';
import { readWorkbenchSettings, writeWorkbenchSettings } from '../shell/workbench-settings.js';
import { withInstrumentation } from '../services/instrumentation/core.js';
import { createActivationGuard } from './activation-guard.js';

export interface PrototypeViewState {
  selectedId: string | null;
  bindingRequestId?: number;
  bindingSurface?: 'flow' | 'panels';
  query: string;
  typeFqn: string | null;
  nativeLayout?: unknown;

  graphVisible: boolean;
  workflowView?: 'flow' | 'panels';
  workflowWidths?: number[];
}

export const normalizeWorkflowWidths = withInstrumentation(
  function normalizeWorkflowWidths(value: unknown): [number, number] {
    return Array.isArray(value) &&
      value.length === 2 &&
      value.every((width) => typeof width === 'number' && Number.isFinite(width) && width >= 22 && width <= 40) &&
      value[0] + value[1] <= 76
      ? [value[0], value[1]]
      : [32, 28];
  },
  {
    op: 'normalizeWorkflowWidths',
    sanitize: () => '[workflow widths]',
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);

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
      set({
        state: {
          ...DEFAULT_PROTOTYPE_VIEW,
          ...restored,
          workflowWidths: normalizeWorkflowWidths(restored.workflowWidths),
          bindingSurface: restored.workflowView === 'panels' ? 'panels' : 'flow',
          workflowView: restored.workflowView === 'panels' ? 'panels' : 'flow'
        }
      });
    }
  },
  patch(patch) {
    activation.invalidate();
    const workspaceId = get().workspaceId;
    const state = { ...get().state, ...patch };
    if (
      Object.prototype.hasOwnProperty.call(patch, 'selectedId') ||
      Object.prototype.hasOwnProperty.call(patch, 'bindingRequestId')
    )
      state.bindingSurface = state.workflowView ?? 'flow';
    set({ state });
    if (workspaceId) void writeWorkbenchSettings(workspaceId, 'prototype-view', state);
  }
}));
