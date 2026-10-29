// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import type React from 'react';
import { usePerspectiveStore } from '../../../store/perspective-store.js';
import { Button } from '@rune-langium/design-system/ui/button';
import { StarterWorkspacePicker } from '../../../components/StarterWorkspacePicker.js';
import './workspace-launcher.css';
import { FileLoader } from '../../../components/FileLoader.js';
import { WorkspaceSwitcher } from '../../../components/WorkspaceSwitcher.js';
import { ReferenceModelPicker } from '../../../components/ReferenceModelPicker.js';
import { useProject } from '../../providers/project-context.js';
import { useWorkspaceActions } from '../workspace-actions-context.js';
import { withInstrumentation } from '../../../services/instrumentation/core.js';
import { config } from '../../../config.js';

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
      onRenameWorkspace,
      onOpenStarter,
      onOpenFolder,
      onStartBlankWorkspace
    } = useWorkspaceActions();

    const project = useProject();
    const section = usePerspectiveStore((state) => state.workspaceSection);
    const setSection = usePerspectiveStore((state) => state.setWorkspaceSection);
    return (
      <section data-testid="workspaces-perspective" className="studio-launcher h-full">
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
          <div hidden={section !== 'workspaces'} className="studio-launcher__workspaces">
            <FileLoader
              onFilesLoaded={onFilesLoaded}
              existingFiles={files}
              onNewWorkspace={onStartBlankWorkspace ?? onCreateWorkspace}
              onOpenFolder={onOpenFolder}
              createGitBackedWorkspace={createGitBackedWorkspace}
              onGitHubWorkspaceCreated={onGitHubWorkspaceCreated}
              openProjectInitialization={openProjectInitialization}
            />
            <WorkspaceSwitcher
              onOpen={onOpenWorkspace}
              onCreate={onCreateWorkspace}
              onDelete={onDeleteWorkspace}
              onRename={onRenameWorkspace}
            />
            <StarterWorkspacePicker
              open={onOpenStarter}
              github={
                config.githubAuthEnabled
                  ? {
                      createWorkspace: createGitBackedWorkspace,
                      onCreated: onGitHubWorkspaceCreated,
                      openProjectInitialization
                    }
                  : undefined
              }
            />
          </div>
          <div hidden={section !== 'references'} className="studio-launcher__references">
            <h2 className="text-sm font-semibold mb-2">Reference models</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Read-only model dependencies belong to the active workspace.
            </p>
            {[
              ...project.diagnostics,
              ...(project.runtime?.diagnostics ?? []),
              ...(project.referenceView?.diagnostics ?? [])
            ].map((issue, index) => (
              <p key={index} role="alert" className="text-xs mb-2">
                {issue.code}: {issue.message}
              </p>
            ))}
            {(project.runtime?.retry || project.referenceView?.status === 'unavailable') && (
              <Button
                size="xs"
                variant="outline"
                className="mb-3"
                onClick={() => {
                  project.runtime?.retry?.();
                  project.referenceView?.retry();
                }}
              >
                Retry reference loading
              </Button>
            )}
            <ReferenceModelPicker
              key={project.workspaceId ?? 'no-workspace'}
              controller={project.controller}
              snapshot={project.snapshot}
              activeBaseline={project.runtime?.input}
              dependenciesLoading={project.runtime?.status === 'loading'}
              onAccepted={project.runtime?.refresh}
            />
          </div>
        </div>
      </section>
    );
  },
  { op: 'WorkspacesPerspective' }
);
