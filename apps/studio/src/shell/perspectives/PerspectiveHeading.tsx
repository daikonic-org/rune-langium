// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
/**
 * PerspectiveHeading — the active perspective's name + icon, rendered in the
 * chrome row directly below the app header (the same row that carries
 * Explore's "Show utilities" / "Reset layout" actions). Every perspective
 * shows this heading in the same location: Explore embeds it in DockShell's
 * layout-presets bar and Compose renders it alongside the composer actions.
 * The other screens get it via PerspectiveHost.
 */
import type React from 'react';
import { withInstrumentation } from '@rune-langium/instrumentation-core';
import { useEditorStore } from '@rune-langium/visual-editor';
import { PERSPECTIVES } from './perspective-registry.js';
import type { PerspectiveId } from './perspective-types.js';

function PerspectiveLocationPath({ label, parts }: { label: string; parts: readonly string[] }) {
  return (
    <nav className="studio-perspective-location" aria-label={label} title={parts.join(' / ')}>
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

function ExploreLocationPath(): React.ReactElement | null {
  const selected = useEditorStore((state) =>
    state.selectedNodeId ? state.nodesById.get(state.selectedNodeId) : undefined
  );
  if (!selected) return null;
  const parts = [...selected.meta.namespace.split('.').filter(Boolean), selected.data.name];
  return <PerspectiveLocationPath label="Explore location" parts={parts} />;
}

export const PerspectiveHeading = withInstrumentation(function PerspectiveHeading({
  perspectiveId,
  location
}: {
  perspectiveId: PerspectiveId;
  location?: string;
}): React.ReactElement | null {
  const perspective = PERSPECTIVES.find((p) => p.id === perspectiveId);
  if (!perspective) return null;
  const Icon = perspective.icon;
  return (
    <div
      className={
        perspectiveId === 'explore' || location
          ? 'studio-perspective-heading studio-perspective-heading--aligned'
          : 'studio-perspective-heading'
      }
    >
      <h1 className="studio-layout-presets__title" data-testid="perspective-heading">
        <Icon className="size-4" aria-hidden="true" />
        <span className="navigation-heading perspective-heading truncate">
          {perspective.title ?? perspective.label}
        </span>
      </h1>
      {perspectiveId === 'explore' ? (
        <ExploreLocationPath />
      ) : location ? (
        <PerspectiveLocationPath label={`${perspective.label} location`} parts={location.split('.').filter(Boolean)} />
      ) : null}
    </div>
  );
});
