// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { create } from 'zustand';
import type { PerspectiveId } from '../shell/perspectives/perspective-types.js';

interface PerspectiveState {
  activePerspective: PerspectiveId;
  workspaceSection: 'workspaces' | 'references';
  setWorkspaceSection(section: 'workspaces' | 'references'): void;
  openWorkspaces(section: 'workspaces' | 'references'): void;
  setActivePerspective: (id: PerspectiveId) => void;
}

export const usePerspectiveStore = create<PerspectiveState>((set) => ({
  // Default to the launcher; App swaps to 'explore' once a workspace loads.
  activePerspective: 'workspaces',
  workspaceSection: 'workspaces',
  setWorkspaceSection: (workspaceSection) => set({ workspaceSection }),
  openWorkspaces: (workspaceSection) => set({ activePerspective: 'workspaces', workspaceSection }),
  setActivePerspective: (id) => set({ activePerspective: id })
}));
