// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import type React from 'react';
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
      onDeleteWorkspace
    } = useWorkspaceActions();

    return (
      <section data-testid="workspaces-perspective" className="studio-scroll h-full overflow-auto">
        <div className="flex flex-col items-center justify-center min-h-full px-8 py-12 gap-8">
          <FileLoader
            onFilesLoaded={onFilesLoaded}
            existingFiles={files}
            createGitBackedWorkspace={createGitBackedWorkspace}
            onGitHubWorkspaceCreated={onGitHubWorkspaceCreated}
            openProjectInitialization={openProjectInitialization}
          />
          <div className="w-full max-w-[560px] mt-8">
            <WorkspaceSwitcher onOpen={onOpenWorkspace} onCreate={onCreateWorkspace} onDelete={onDeleteWorkspace} />
          </div>
          <div className="w-full max-w-[560px]">
            <ModelLoader />
          </div>
        </div>
      </section>
    );
  },
  { op: 'WorkspacesPerspective' }
);
