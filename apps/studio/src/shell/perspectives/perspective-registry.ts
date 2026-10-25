// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { Layers, FolderOpen, GitBranch, Package, Settings, Boxes } from 'lucide-react';
import type { Perspective, PerspectiveId } from './perspective-types.js';
import { ExploreCenterSlot, ExploreActions } from './explore-chrome.js';
import { PrototypeActions } from './prototype-chrome.js';
import { withInstrumentation, Capture } from '../../services/instrumentation/core.js';

/** Rail order, top group first; settings pinned to the bottom group. */
export const PERSPECTIVES: readonly Perspective[] = [
  {
    id: 'explore',
    label: 'Explore',
    icon: Layers,
    group: 'main',
    requiresWorkspace: true,
    centerSlot: ExploreCenterSlot,
    actions: ExploreActions
  },
  {
    id: 'workspaces',
    label: 'Workspaces',
    icon: FolderOpen,
    group: 'main',
    requiresWorkspace: false,
    title: 'Workspaces'
  },
  {
    id: 'git',
    label: 'Git / Sync',
    icon: GitBranch,
    group: 'main',
    requiresWorkspace: true,
    title: 'Git / Sync'
  },
  {
    id: 'export',
    label: 'Export / Packaging',
    icon: Package,
    group: 'main',
    requiresWorkspace: true,
    title: 'Export / Packaging'
  },
  {
    id: 'prototype',
    label: 'Prototype',
    icon: Boxes,
    group: 'main',
    requiresWorkspace: true,
    title: 'Prototype',
    actions: PrototypeActions
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: Settings,
    group: 'bottom',
    requiresWorkspace: false,
    title: 'Settings'
  }
];

export const resolveEffectivePerspective = withInstrumentation(
  function resolveEffectivePerspective(
    active: PerspectiveId,
    ctx: { hasWorkspace: boolean; hasExploreContent: boolean }
  ): PerspectiveId {
    const requiresWorkspace = PERSPECTIVES.find((p) => p.id === active)?.requiresWorkspace ?? false;
    const missingRequiredContext =
      active === 'explore' ? !ctx.hasExploreContent : requiresWorkspace && !ctx.hasWorkspace;
    return missingRequiredContext ? 'workspaces' : active;
    // `active` and the output are both a fixed PerspectiveId enum; `ctx` is
    // two booleans — all safe.
  },
  { op: 'resolveEffectivePerspective', capture: Capture.Input | Capture.Output, sanitize: (value) => value }
);
