// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Daikonic contributors
import type { WorkflowDescriptor } from '@rune-langium/project-config';
import type { ExpressionAddress } from '@rune-langium/core';
import { create } from 'zustand';

type SourceRequest = { workspaceKey: string; nodeId: string; target?: ExpressionAddress };

/** Navigation intent only. Executable composition state lives in Rune source. */
export const useComposeNavigationStore = create<{
  creating: boolean;
  setCreating(value: boolean): void;
  recipe?: { workspaceId: string; descriptor: WorkflowDescriptor };
  requestRecipe(workspaceId: string, recipe: WorkflowDescriptor): void;
  source?: SourceRequest;
  requestSource(workspaceKey: string, nodeId: string, target?: ExpressionAddress): void;
  clearSource(request: SourceRequest): void;
}>((set) => ({
  creating: false,
  requestRecipe: (workspaceId, descriptor) => set({ recipe: { workspaceId, descriptor } }),
  requestSource: (workspaceKey, nodeId, target) => set({ source: { workspaceKey, nodeId, target } }),
  clearSource: (request) => set((state) => (state.source === request ? { source: undefined } : state)),
  setCreating: (creating) => set({ creating })
}));
