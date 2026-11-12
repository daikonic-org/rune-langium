// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export type PerspectiveId = 'explore' | 'workspaces' | 'git' | 'export' | 'settings' | 'prototype' | 'compose';

export interface Perspective {
  id: PerspectiveId;
  label: string;
  icon: LucideIcon;
  /** Rail placement: 'main' (top group) or 'bottom' (settings group). */
  group: 'main' | 'bottom';
  /** Explore/Git/Export need a loaded workspace; rail button disabled otherwise. */
  requiresWorkspace: boolean;
  /** Bar title, center-left, for perspectives without a centerSlot. Defaults to `label`. */
  title?: string;
  /** Center of the bar (Explore: FileTabStrip). Wins over `title`. */
  centerSlot?: () => ReactNode;
  /** Per-perspective action cluster, rendered LEFT of the global utilities. */
  actions?: () => ReactNode;
}
