// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';
import { withInstrumentation } from '../services/instrumentation/core.js';

/** Shared hide/show chrome for the utility tray and auxiliary side panels. */
export const PanelCollapseButton = withInstrumentation(
  function PanelCollapseButton({
    label,
    collapsed,
    direction,
    onToggle,
    testId
  }: {
    label: string;
    collapsed: boolean;
    direction: 'left' | 'right' | 'bottom';
    onToggle(): void;
    testId?: string;
  }) {
    const action = `${collapsed ? 'Show' : 'Hide'} ${label}`;
    const Icon =
      direction === 'bottom'
        ? collapsed
          ? ChevronUp
          : ChevronDown
        : (direction === 'left') !== collapsed
          ? ChevronLeft
          : ChevronRight;
    return (
      <button
        type="button"
        className="studio-panel-action studio-utility-toggle"
        onClick={onToggle}
        aria-label={action}
        title={action}
        aria-expanded={!collapsed}
        data-testid={testId}
      >
        <Icon className="size-4" aria-hidden="true" />
      </button>
    );
  },
  { op: 'PanelCollapseButton' }
);
