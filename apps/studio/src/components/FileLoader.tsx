// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * FileLoader — Drag-and-drop + file picker for loading .rosetta files (T084, T099).
 *
 * Shows a progress bar during chunked file reading for large folders.
 */

import { useCallback, useRef, useState } from 'react';
import type { WorkspaceFile, WorkspaceLoadProgress } from '../services/workspace.js';
import { createBlankWorkspaceFile, readFileList } from '../services/workspace.js';
import { Button } from '@rune-langium/design-system/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@rune-langium/design-system/ui/dialog';
import { cn } from '@rune-langium/design-system/utils';
import type { GitHubInitializationSession } from '../workspace/project-initialization.js';
import { GitHubWorkspaceFlow } from './GitHubWorkspaceFlow.js';
import { config } from '../config.js';
import { withInstrumentation } from '../services/instrumentation/core.js';

const EMPTY_FILES: ReadonlyArray<WorkspaceFile> = [];

export interface FileLoaderProps {
  onNewWorkspace?: () => void | Promise<void>;
  onOpenFolder?: () => Promise<void>;
  onFilesLoaded: (files: WorkspaceFile[]) => void;
  /**
   * Current workspace files — used to compute a unique name for the "New"
   * action (`untitled.rosetta`, `untitled-2.rosetta`, …). Defaults to empty.
   */
  existingFiles?: ReadonlyArray<WorkspaceFile>;
  /**
   * Override the github-auth base URL (T031 / FR-012). Defaults to the
   * production same-origin path; tests inject their own.
   */
  githubAuthBase?: string;
  /**
   * Inject a workspace-creation function for the GitHub flow (T032e).
   * Production callers pass a thin wrapper around
   * `WorkspaceManager.createGitBacked`. Tests can stub this to avoid
   * mounting a real OPFS root. Omit to hide the writable-repository action.
   */
  createGitBackedWorkspace?: (input: {
    name: string;
    repoUrl: string;
    branch: string;
    user: string;
    token: string;
  }) => Promise<{ id: string }>;
  /**
   * Notified when the GitHub flow successfully creates a workspace.
   * App.tsx swaps to that workspace via WorkspaceManager.open(id).
   */
  onGitHubWorkspaceCreated?: (workspaceId: string) => void | Promise<void>;
  openProjectInitialization?: (workspaceId: string) => Promise<GitHubInitializationSession | undefined>;
}

function defaultGithubAuthBase(): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/rune-studio/api/github-auth`;
}

export const FileLoader = withInstrumentation(
  function FileLoader({
    onFilesLoaded,
    existingFiles = EMPTY_FILES,
    githubAuthBase,
    createGitBackedWorkspace,
    onGitHubWorkspaceCreated,
    openProjectInitialization,
    onNewWorkspace,
    onOpenFolder
  }: FileLoaderProps) {
    const [isDragging, setIsDragging] = useState(false);
    const [error, setError] = useState<string>();
    const perform = async (action: () => void | Promise<void>) => {
      setError(undefined);
      try {
        await action();
      } catch (error) {
        if (!(error instanceof Error && error.name === 'AbortError'))
          setError(error instanceof Error ? error.message : 'The workspace could not be opened. Try again.');
      }
    };
    const [loadProgress, setLoadProgress] = useState<WorkspaceLoadProgress | null>(null);
    const [isGitHubOpen, setIsGitHubOpen] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dirInputRef = useRef<HTMLInputElement>(null);
    const authBase = githubAuthBase ?? defaultGithubAuthBase();

    const handleFiles = useCallback(
      async (fileList: FileList) => {
        setLoadProgress({ phase: 'reading', loaded: 0, total: 0 });
        const files = await readFileList(fileList, (progress) => {
          setLoadProgress(progress);
        });
        setLoadProgress({ phase: 'syncing', loaded: files.length, total: files.length });
        if (files.length > 0) {
          onFilesLoaded(files);
        }
        setLoadProgress(null);
      },
      [onFilesLoaded]
    );

    const handleDrop = useCallback(
      async (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files.length > 0) {
          await handleFiles(e.dataTransfer.files);
        }
      },
      [handleFiles]
    );

    const handleDragOver = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(true);
    }, []);

    const handleDragLeave = useCallback(() => {
      setIsDragging(false);
    }, []);

    const handleFileInput = useCallback(
      async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
          await handleFiles(e.target.files);
        }
      },
      [handleFiles]
    );

    const handleNew = useCallback(() => {
      const file = createBlankWorkspaceFile(existingFiles);
      onFilesLoaded([file]);
    }, [existingFiles, onFilesLoaded]);

    return (
      <section
        className={cn('w-full min-w-0 transition-colors rounded-lg', isDragging && 'bg-primary/15')}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        data-testid="file-loader"
        aria-label="File loader"
      >
        <div className="w-full min-w-0">
          <p className="text-sm text-muted-foreground mb-3">Open your work or start with an example project.</p>
          {error && (
            <p role="alert" className="text-sm text-destructive mb-2">
              {error}
            </p>
          )}
          {loadProgress ? (
            <div className="w-full" data-testid="load-progress">
              <div className="w-full bg-muted rounded-full h-2 mb-2 overflow-hidden">
                <div
                  className="w-full h-2 rounded-full bg-primary origin-left transition-transform"
                  style={{
                    transform: `scaleX(${loadProgress.total > 0 ? loadProgress.loaded / loadProgress.total : 0})`
                  }}
                  role="progressbar"
                  aria-valuenow={loadProgress.loaded}
                  aria-valuemin={0}
                  aria-valuemax={loadProgress.total}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                {loadProgress.phase === 'reading'
                  ? `Loading ${loadProgress.loaded}/${loadProgress.total} files...`
                  : 'Syncing with language server...'}
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <Button size="sm" onClick={() => void perform(onNewWorkspace ?? handleNew)}>
                New workspace
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void perform(onOpenFolder ?? (() => dirInputRef.current?.click()))}
              >
                Open folder
              </Button>
              {config.githubAuthEnabled && createGitBackedWorkspace && (
                <Button variant="outline" size="sm" onClick={() => setIsGitHubOpen(true)}>
                  Open GitHub
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()}>
                Import files…
              </Button>
            </div>
          )}

          {config.githubAuthEnabled && createGitBackedWorkspace && (
            <Dialog open={isGitHubOpen} onOpenChange={setIsGitHubOpen}>
              <DialogContent className="max-w-xl max-h-[90dvh] overflow-y-auto studio-scroll">
                <DialogHeader>
                  <DialogTitle>Open from GitHub</DialogTitle>
                  <DialogDescription className="text-foreground/75">
                    Connect GitHub to clone a writable repository. Public starter copies do not require signing in.
                  </DialogDescription>
                </DialogHeader>
                <GitHubWorkspaceFlow
                  authBase={authBase}
                  createWorkspace={createGitBackedWorkspace}
                  openProjectInitialization={openProjectInitialization}
                  onCreated={async (id) => {
                    await onGitHubWorkspaceCreated?.(id);
                    setIsGitHubOpen(false);
                  }}
                  onCancel={() => setIsGitHubOpen(false)}
                />
              </DialogContent>
            </Dialog>
          )}

          {/* Visually hidden — NOT display:none, Chrome blocks .click() on those.
        aria-label is required even on hidden inputs: axe-core flags an
        unlabeled file input as a critical violation regardless of CSS. */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".rosetta"
            multiple
            aria-label="Choose .rosetta files"
            onChange={handleFileInput}
            style={{ position: 'absolute', width: 0, height: 0, opacity: 0, overflow: 'hidden' }}
          />
          <input
            ref={dirInputRef}
            type="file"
            // @ts-expect-error webkitdirectory is not in the type defs
            webkitdirectory=""
            aria-label="Choose a folder of .rosetta files"
            onChange={handleFileInput}
            style={{ position: 'absolute', width: 0, height: 0, opacity: 0, overflow: 'hidden' }}
          />
        </div>
      </section>
    );
  },
  { op: 'FileLoader' }
);
