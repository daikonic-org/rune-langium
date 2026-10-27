// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
/**
 * PerspectiveHost — renders the active perspective in the shell content slot.
 * Explore (the `ExplorePerspective` DockShell workbench) is ALWAYS mounted and
 * hidden via `display:none` when inactive — keep-alive preserves the dockview
 * layout, open files, unsaved edits, and the LSP worker. Prototype stays mounted
 * after its first visit in the current workspace to retain input drafts. Other screens mount on demand.
 */
import { useState, type ReactNode } from 'react';
import type React from 'react';
import type { PerspectiveId } from './perspective-types.js';
import { usePerspectiveStore } from '../../store/perspective-store.js';
import { resolveEffectivePerspective } from './perspective-registry.js';
import { SettingsPerspective } from './screens/SettingsPerspective.js';
import { WorkspaceDirectoriesFormAdapter } from '../../codegen-forms/WorkspaceDirectoriesFormAdapter.js';
import { WorkspacesPerspective } from './screens/WorkspacesPerspective.js';
import { GitSyncPerspective } from './screens/GitSyncPerspective.js';
import { ExportPerspective } from './screens/ExportPerspective.js';
import { PrototypePerspective } from './screens/PrototypePerspective.js';
import { ExplorePerspective } from '../ExplorePerspective.js';
import type { WorkspaceKind } from '../../workspace/persistence.js';
import type { WorkspaceFile } from '../../services/workspace.js';
import { withInstrumentation } from '../../services/instrumentation/core.js';
import { PerspectiveHeading } from './PerspectiveHeading.js';

interface Props {
  hasWorkspace: boolean;
  hasExploreContent: boolean;
  /** Forwarded to GitSyncPerspective for the sync-engine subscription. */
  workspaceId?: string;
  /** Forwarded to GitSyncPerspective for the sync-engine subscription. */
  workspaceKind?: WorkspaceKind;
  /** Workspace files forwarded to ExportPerspective for the Download flow. */
  files?: ReadonlyArray<WorkspaceFile>;
}

function PerspectiveScreen({
  id,
  active = true,
  children
}: {
  id: PerspectiveId;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      data-perspective-slot={id}
      style={{ display: active ? undefined : 'none' }}
      className="flex h-full min-h-0 min-w-0 flex-col studio-perspective-enter"
    >
      <div className="studio-layout-presets" data-testid={active ? 'perspective-header-row' : undefined}>
        <PerspectiveHeading perspectiveId={id} />
      </div>
      <div className="min-h-0 min-w-0 flex-1">{children}</div>
    </div>
  );
}

export const PerspectiveHost = withInstrumentation(
  function PerspectiveHost({
    hasWorkspace,
    hasExploreContent,
    workspaceId,
    workspaceKind,
    files
  }: Props): React.ReactElement {
    const active = usePerspectiveStore((s) => s.activePerspective);
    // Effective-perspective fallback — shared with AppHeader via
    // resolveEffectivePerspective so the bar and the body never disagree.
    const effective = resolveEffectivePerspective(active, { hasWorkspace, hasExploreContent });
    const key = workspaceId ?? ':session';
    const [prototypeWorkspace, setPrototypeWorkspace] = useState<string>();
    if (effective === 'prototype' && prototypeWorkspace !== key) setPrototypeWorkspace(key);
    return (
      // `min-w-0` is load-bearing: this is a flex item of the App content row.
      // Without it the item's `min-width: auto` refuses to shrink below its
      // content's min-content width, so a wide child (e.g. the open-file tab
      // strip with many files) forces this host — and the whole layout — past
      // the viewport. `min-w-0` lets it honor the row width and clip/scroll inside.
      <div className="flex-1 min-h-0 min-w-0">
        {/* Explore: kept alive — hidden via display:none, NEVER unmounted. */}
        <div
          data-perspective-slot="explore"
          // `studio-perspective-enter` replays its fade-in each time the class
          // is re-added (i.e. every time Explore becomes active again).
          className={effective === 'explore' ? 'h-full studio-perspective-enter' : 'h-full'}
          style={{ display: effective === 'explore' ? undefined : 'none' }}
        >
          <ExplorePerspective />
        </div>
        {hasWorkspace && prototypeWorkspace === key ? (
          <PerspectiveScreen key={key} id="prototype" active={effective === 'prototype'}>
            <PrototypePerspective />
          </PerspectiveScreen>
        ) : null}
        {effective !== 'explore' && effective !== 'prototype' && (
          <PerspectiveScreen key={effective} id={effective}>
            {effective === 'workspaces' && <WorkspacesPerspective />}
            {effective === 'git' && <GitSyncPerspective workspaceId={workspaceId} workspaceKind={workspaceKind} />}
            {effective === 'export' && <ExportPerspective files={files} workspaceId={workspaceId} />}
            {effective === 'settings' && <SettingsPerspective workspaceForm={WorkspaceDirectoriesFormAdapter} />}
          </PerspectiveScreen>
        )}
      </div>
    );
  },
  { op: 'PerspectiveHost' }
);
