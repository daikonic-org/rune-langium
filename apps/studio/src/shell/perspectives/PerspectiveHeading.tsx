// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
/**
 * PerspectiveHeading — the active perspective's name + icon, rendered in the
 * chrome row directly below the app header (the same row that carries
 * Explore's "Show utilities" / "Reset layout" actions). Every perspective
 * shows this heading in the same location: Explore embeds it in DockShell's
 * layout-presets bar; the other screens get it via PerspectiveHost.
 */
import type React from 'react';
import { withInstrumentation } from '@rune-langium/instrumentation-core';
import { useEditorStore } from '@rune-langium/visual-editor';
import { useDesignPreviewStore } from '../../store/design-preview-store.js';
import { PERSPECTIVES } from './perspective-registry.js';
import type { PerspectiveId } from './perspective-types.js';

function ExploreLocationPath(): React.ReactElement | null {
  const selected = useEditorStore((state) =>
    state.selectedNodeId ? state.nodesById.get(state.selectedNodeId) : undefined
  );
  if (!selected) return null;
  const parts = [...selected.meta.namespace.split('.').filter(Boolean), selected.data.name];
  return (
    <nav className="studio-explore-location" aria-label="Explore location" title={parts.join(' / ')}>
      <ol dir="ltr">
        {parts.map((part, index) => (
          <li key={index} aria-current={index === parts.length - 1 ? 'location' : undefined}>
            {index > 0 && <span aria-hidden="true"> / </span>}
            {part}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export const PerspectiveHeading = withInstrumentation(function PerspectiveHeading({
  perspectiveId
}: {
  perspectiveId: PerspectiveId;
}): React.ReactElement | null {
  const showPath = useDesignPreviewStore((state) => state.preferences.path);
  const perspective = PERSPECTIVES.find((p) => p.id === perspectiveId);
  if (!perspective) return null;
  const Icon = perspective.icon;
  return (
    <div
      className={
        perspectiveId === 'explore' && showPath
          ? 'studio-perspective-heading studio-perspective-heading--aligned'
          : 'studio-perspective-heading'
      }
    >
      <h1 className="studio-layout-presets__title" data-testid="perspective-heading">
        <Icon className="size-4" aria-hidden="true" />
        <span className="truncate">{perspective.title ?? perspective.label}</span>
      </h1>
      {perspectiveId === 'explore' && showPath && <ExploreLocationPath />}
    </div>
  );
});
