// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Daikonic contributors

import { useEffect, useState, type ComponentType, type ReactNode, type RefObject, type SVGProps } from 'react';
import type { DockviewApi } from 'dockview-react';
import { ButtonLabel } from '@rune-langium/design-system/ui/button';
import { withInstrumentation } from '../services/instrumentation/core.js';

function observeWorkbenchLocation(api: DockviewApi, shell: HTMLElement, selector: string) {
  let center: Element | null = null;
  const update = () => {
    const next = shell.querySelector(selector);
    if (center !== next) {
      if (center) observer.unobserve(center);
      if (next) observer.observe(next);
      center = next;
    }
    const rect = center?.getBoundingClientRect();
    if (rect?.width)
      shell.style.setProperty(
        '--rune-center-stack-start',
        `${Math.max(0, rect.left - shell.getBoundingClientRect().left)}px`
      );
  };
  const observer = new ResizeObserver(update);
  observer.observe(shell);
  const listener = api.onDidLayoutChange(update);
  const frame = requestAnimationFrame(update);
  update();
  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    listener.dispose();
    shell.style.removeProperty('--rune-center-stack-start');
  };
}

/** Keep the breadcrumb aligned with the center dock group as the layout moves. */
export const useWorkbenchLocation = withInstrumentation(
  function useWorkbenchLocation(shellRef: RefObject<HTMLElement | null>, selector: string) {
    const [api, setApi] = useState<DockviewApi>();
    useEffect(() => {
      const shell = shellRef.current;
      if (api && shell) return observeWorkbenchLocation(api, shell, selector);
    }, [api, selector, shellRef]);
    return setApi;
  },
  { op: 'useWorkbenchLocation', capture: 0 }
);

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
        <h2 className="font-title text-xs font-medium text-foreground">{label}</h2>
        {children}
      </div>
    );
  },
  { op: 'WorkbenchPaneHeading', capture: 0 }
);
