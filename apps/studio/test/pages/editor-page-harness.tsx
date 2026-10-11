// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * Test harness for EditorPage after the provider refactor.
 *
 * EditorPage no longer takes props — it reads workspace data from
 * WorkspaceProvider (useWorkspace), LSP handles from LspContext (useLsp), and
 * workspace actions from WorkspaceActionsContext (useWorkspaceActions). This
 * harness maps the former prop set onto those contexts so existing EditorPage
 * tests keep their prop-shaped call sites.
 *
 * The codegen/preview worker is owned by CodegenProvider, which this harness
 * mounts so the worker-driving effects run exactly as in production (tests that
 * stub `global.Worker` with a MockWorker continue to observe instances). The
 * LSP transport is supplied directly as a context value — NOT via the real
 * LspProvider — so tests don't open a network connection.
 *
 * Mounts `AppHeader` alongside `ExplorePerspective`, mirroring `App.tsx`'s
 * real composition (shared-perspective-chrome plan, Task 3): the top bar
 * (brand/switcher, FileTabStrip, Validate/Export/Share/Generate) is no
 * longer part of ExplorePerspective's own render tree.
 */

import type React from 'react';
import { render } from '@testing-library/react';
import type { RosettaModel } from '@rune-langium/core';
import { CodegenProvider } from '../../src/shell/providers/CodegenProvider.js';
import { WorkspaceStateContext, type WorkspaceState } from '../../src/shell/providers/workspace-context.js';
import { LspContext, type LspContextValue } from '../../src/shell/providers/lsp-context.js';
import {
  WorkspaceActionsContext,
  type WorkspaceActions
} from '../../src/shell/perspectives/workspace-actions-context.js';
import type { WorkspaceFile, ParsedWorkspaceModel } from '../../src/services/workspace.js';
import type { LspClientService } from '../../src/services/lsp-client.js';
import type { TransportState } from '../../src/services/transport-provider.js';
import type { WorkspaceKind } from '../../src/workspace/persistence.js';
import type { DeferredExportEntry } from '../../src/workers/parser-worker.js';
import { ExplorePerspective } from '../../src/shell/ExplorePerspective.js';
import { AppHeader } from '../../src/shell/AppHeader.js';

export interface EditorPageHarnessProps {
  models?: RosettaModel[];
  parsedModels?: ParsedWorkspaceModel[];
  deferredExports?: DeferredExportEntry[];
  parseErrors?: Map<string, string[]>;
  files?: WorkspaceFile[];
  loadCuratedSource?: WorkspaceActions['loadCuratedSource'];
  onFilesChange?: (files: WorkspaceFile[]) => void;
  lspClient?: LspClientService;
  transportState?: TransportState;
  onReconnect?: () => void;
  workspaceId?: string;
  workspaceKind?: WorkspaceKind;
  workspaceName?: string;
  fileCount?: number;
  onClose?: () => void;
  onSwitchWorkspace?: (workspaceId: string) => void;
  onCreateWorkspace?: () => void;
}

const noop = () => {};

function EditorPageHarness(props: EditorPageHarnessProps): React.ReactElement {
  const files = props.files ?? [];
  const workspaceState: WorkspaceState = {
    workspaceId: props.workspaceId ?? 'default',
    workspaceKind: props.workspaceKind,
    workspaceName: props.workspaceName,
    fileCount: props.fileCount ?? files.filter((f) => !f.readOnly).length,
    files,
    models: props.models ?? [],
    parsedModels: props.parsedModels ?? [],
    deferredExports: props.deferredExports ?? [],
    parseErrors: props.parseErrors ?? new Map()
  };

  const lspValue: LspContextValue = {
    lspClient: props.lspClient ?? null,
    // Mirror the old prop default: when a test does not supply transportState,
    // EditorPage's `transportState && <LspConnectionBadge/>` guard must stay
    // falsy so the LSP badges are not rendered (and their lucide icons are not
    // required by minimal test mocks).
    transportState: props.transportState as TransportState,
    reconnect: props.onReconnect ?? noop
  };

  const actions: WorkspaceActions = {
    files,
    onFilesLoaded: noop,
    createGitBackedWorkspace: async () => ({ id: 'test-ws' }),
    onGitHubWorkspaceCreated: noop,
    onOpenWorkspace: noop,
    onCreateWorkspace: props.onCreateWorkspace ?? noop,
    onDeleteWorkspace: noop,
    onFilesChange: props.onFilesChange ?? noop,
    loadCuratedSource: props.loadCuratedSource ?? (async () => {}),
    onClose: props.onClose ?? noop,
    onSwitchWorkspace: props.onSwitchWorkspace ?? noop
  };

  // The harness always represents a loaded workspace with Explore content —
  // callers that need the fallback state (no workspace/no content) test
  // AppHeader/PerspectiveHost directly via resolveEffectivePerspective
  // rather than through this harness.
  return (
    <WorkspaceActionsContext.Provider value={actions}>
      <WorkspaceStateContext.Provider value={workspaceState}>
        <LspContext.Provider value={lspValue}>
          <CodegenProvider>
            <AppHeader hasWorkspace hasExploreContent />
            <ExplorePerspective />
          </CodegenProvider>
        </LspContext.Provider>
      </WorkspaceStateContext.Provider>
    </WorkspaceActionsContext.Provider>
  );
}

/** Render EditorPage with the former prop set mapped onto context. */
export function renderEditorPage(props: EditorPageHarnessProps = {}) {
  const view = render(<EditorPageHarness {...props} />);
  return {
    ...view,
    rerenderEditorPage: (next: EditorPageHarnessProps) => view.rerender(<EditorPageHarness {...next} />)
  };
}
