// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import type React from 'react';
import { useState } from 'react';
import { Button } from '@rune-langium/design-system/ui/button';
import { StarterWorkspacePicker } from '../../../components/StarterWorkspacePicker.js';
import './workspace-launcher.css';
import { FileLoader } from '../../../components/FileLoader.js';
import { WorkspaceSwitcher } from '../../../components/WorkspaceSwitcher.js';
import { ModelLoader } from '../../../components/ModelLoader.js';
import { useWorkspaceActions } from '../workspace-actions-context.js';
import { withInstrumentation } from '../../../services/instrumentation/core.js';

export const WorkspacesPerspective = withInstrumentation(
  function WorkspacesPerspective(): React.ReactElement {
    const {
      files,
      onFilesLoaded,
      createGitBackedWorkspace,
      onGitHubWorkspaceCreated,
      openProjectInitialization,
      onOpenWorkspace,
      onCreateWorkspace,
      onDeleteWorkspace,
      onOpenStarter,
      onOpenFolder,
      onStartBlankWorkspace
    } = useWorkspaceActions();

    const [section, setSection] = useState<'workspaces' | 'references'>('workspaces');
    return (
      <section data-testid="workspaces-perspective" className="studio-launcher studio-scroll h-full overflow-auto">
        <div className="studio-launcher__body">
          <nav className="studio-launcher__navigation" aria-label="Project launcher">
            <Button
              size="sm"
              variant="ghost"
              aria-pressed={section === 'workspaces'}
              onClick={() => setSection('workspaces')}
            >
              Workspaces
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-pressed={section === 'references'}
              onClick={() => setSection('references')}
            >
              Reference models
            </Button>
          </nav>
          <div hidden={section !== 'workspaces'} className="space-y-6">
            <FileLoader
              onFilesLoaded={onFilesLoaded}
              existingFiles={files}
              onNewWorkspace={onStartBlankWorkspace ?? onCreateWorkspace}
              onOpenFolder={onOpenFolder}
              createGitBackedWorkspace={createGitBackedWorkspace}
              onGitHubWorkspaceCreated={onGitHubWorkspaceCreated}
              openProjectInitialization={openProjectInitialization}
            />
            <WorkspaceSwitcher onOpen={onOpenWorkspace} onCreate={onCreateWorkspace} onDelete={onDeleteWorkspace} />
            <StarterWorkspacePicker open={onOpenStarter} />
          </div>
          <div hidden={section !== 'references'}>
            <h2 className="text-sm font-semibold mb-2">Reference models</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Read-only model dependencies belong to the active workspace.
            </p>
            <ModelLoader />
          </div>
        </div>
      </section>
    );
  },
  { op: 'WorkspacesPerspective' }
);
