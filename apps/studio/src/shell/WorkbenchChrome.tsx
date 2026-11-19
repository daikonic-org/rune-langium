// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Daikonic contributors

import type { ComponentType, ReactNode, SVGProps } from 'react';
import { ButtonLabel } from '@rune-langium/design-system/ui/button';
import { withInstrumentation } from '../services/instrumentation/core.js';

interface WorkbenchView {
  id: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  active: boolean;
  pending?: boolean;
  disabled?: boolean;
  onToggle(): void;
}

/** One center-view switcher vocabulary across Explore and Compose. */
export const WorkbenchViewBar = withInstrumentation(
  function WorkbenchViewBar({
    groups,
    label,
    testId,
    children,
    actions
  }: {
    groups: readonly { label: string; views: readonly WorkbenchView[] }[];
    label: string;
    testId?: string;
    children?: ReactNode;
    actions?: ReactNode;
  }) {
    return (
      <div className="studio-center-stack__bar" role="toolbar" aria-label={label} data-testid={testId}>
        <div className="studio-paneswitch">
          {groups.map((group) => (
            <div key={group.label} className="studio-paneswitch__group" role="group" aria-label={group.label}>
              {group.views.map(({ id, label: title, icon: Icon, active, pending, disabled, onToggle }) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={active}
                  disabled={disabled}
                  className={active ? 'studio-paneswitch__seg is-active' : 'studio-paneswitch__seg'}
                  onClick={onToggle}
                >
                  <Icon className={pending ? 'size-3.5 studio-navigation-pending' : 'size-3.5'} aria-hidden="true" />
                  <ButtonLabel>{title}</ButtonLabel>
                </button>
              ))}
            </div>
          ))}
        </div>
        {children}
        <div className="flex-1" />
        {actions}
      </div>
    );
  },
  { op: 'WorkbenchViewBar', capture: 0 }
);

export const WorkbenchPaneHeading = withInstrumentation(
  function WorkbenchPaneHeading({ label, children }: { label: string; children?: ReactNode }) {
    return (
      <div className="studio-center-stack__pane-heading min-h-6">
        <span className="font-title text-xs font-medium">{label}</span>
        {children}
      </div>
    );
  },
  { op: 'WorkbenchPaneHeading', capture: 0 }
);
