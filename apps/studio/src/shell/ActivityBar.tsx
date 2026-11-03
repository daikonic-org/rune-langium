// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
/**
 * ActivityBar — always-visible left rail. Renders one button per registered
 * perspective and drives `usePerspectiveStore`. Lives outside the dockview
 * group so user layouts can't hide it. requiresWorkspace perspectives are
 * disabled until a workspace is loaded.
 */
import type React from 'react';
import { StudioHelp } from '../components/StudioHelp.js';
import { PERSPECTIVES } from './perspectives/perspective-registry.js';
import type { Perspective } from './perspectives/perspective-types.js';
import { usePerspectiveStore } from '../store/perspective-store.js';
import { withInstrumentation } from '../services/instrumentation/core.js';

interface Props {
  hasWorkspace: boolean;
  hasExploreContent: boolean;
}

export const ActivityBar = withInstrumentation(
  function ActivityBar({ hasWorkspace, hasExploreContent }: Props): React.ReactElement {
    const active = usePerspectiveStore((s) => s.activePerspective);
    const setActive = usePerspectiveStore((s) => s.setActivePerspective);

    const renderButton = (p: Perspective) => {
      const Icon = p.icon;
      const disabled = p.id === 'explore' ? !hasExploreContent : p.requiresWorkspace && !hasWorkspace;
      const isActive = active === p.id;
      return (
        <button
          key={p.id}
          type="button"
          className="studio-rail__btn"
          aria-label={p.label}
          aria-pressed={isActive}
          disabled={disabled}
          data-testid={`rail-${p.id}`}
          onClick={() => setActive(p.id)}
        >
          {isActive && <span className="studio-rail__pip" />}
          <Icon className="size-4" />
        </button>
      );
    };

    const mainButtons: React.ReactElement[] = [];
    const bottomButtons: React.ReactElement[] = [];
    for (const p of PERSPECTIVES) {
      if (p.group === 'main') mainButtons.push(renderButton(p));
      else if (p.group === 'bottom') bottomButtons.push(renderButton(p));
    }

    return (
      <nav aria-label="Studio activity bar" data-testid="activity-bar" className="studio-rail">
        <div className="studio-rail__group">{mainButtons}</div>
        <div className="studio-rail__spacer" />
        <div className="studio-rail__group">
          <StudioHelp />
          {bottomButtons}
        </div>
      </nav>
    );
  },
  { op: 'ActivityBar' }
);
