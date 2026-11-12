// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Daikonic contributors
import type { WorkflowDescriptor } from '@rune-langium/project-config';
import { create } from 'zustand';

/** Navigation intent only. Executable composition state lives in Rune source. */
export const useComposeNavigationStore = create<{
  creating: boolean;
  setCreating(value: boolean): void;
  recipe?: { workspaceId: string; descriptor: WorkflowDescriptor };
  requestRecipe(workspaceId: string, recipe: WorkflowDescriptor): void;
}>((set) => ({
  creating: false,
  requestRecipe: (workspaceId, descriptor) => set({ recipe: { workspaceId, descriptor } }),
  setCreating: (creating) => set({ creating })
}));
