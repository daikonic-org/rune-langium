// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import {
  discoverProjectConfig,
  inspectMavenProject,
  projectFileRevision,
  ProjectSnapshotError,
  type MavenImportPreview,
  type ProjectFiles,
  type ProjectSavePreconditions,
  type ProjectSnapshot
} from '@rune-langium/project-config';
import type { ProjectController } from './project-controller.js';
import { withInstrumentation } from '../services/instrumentation/core.js';

export const detectProjectInitialization = withInstrumentation(
  function detectProjectInitialization(
    files: ProjectFiles
  ): { kind: 'configured' } | { kind: 'maven'; pomPath: string } | { kind: 'plain' } {
    const config = discoverProjectConfig(files);
    if (config.diagnostics.length) throw new ProjectSnapshotError(config.diagnostics);
    if (config.build) return { kind: 'configured' };
    return files.has('pom.xml') ? { kind: 'maven', pomPath: 'pom.xml' } : { kind: 'plain' };
  },
  { op: 'detectProjectInitialization', sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' }) }
);

export interface ReviewedMavenImportPreview extends MavenImportPreview {
  preconditions: ProjectSavePreconditions;
}

export const prepareGitHubInitialization = withInstrumentation(
  async function prepareGitHubInitialization(
    snapshot: ProjectSnapshot,
    profiles: readonly string[]
  ): Promise<ReviewedMavenImportPreview> {
    const detected = detectProjectInitialization(snapshot.files);
    if (detected.kind !== 'maven') throw new Error('This repository does not need Maven initialization');
    const preview = inspectMavenProject(snapshot.files, { pomPath: detected.pomPath, profiles });
    return {
      ...preview,
      preconditions: {
        paths: [...snapshot.files.keys()],
        inputs: await Promise.all(
          [...snapshot.files].map(async ([path, text]) => ({
            path,
            revision: snapshot.fileRevisions.get(path) ?? (await projectFileRevision(text))
          }))
        )
      }
    };
  },
  { op: 'prepareGitHubInitialization', sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' }) }
);

export interface GitHubInitializationSession {
  readonly snapshot: ProjectSnapshot;
  prepare(profiles: readonly string[]): Promise<ReviewedMavenImportPreview>;
  save(preview: ReviewedMavenImportPreview): Promise<ProjectSnapshot>;
  dispose(): void;
}

export const createGitHubInitializationSession = withInstrumentation(
  async function createGitHubInitializationSession(
    controller: ProjectController
  ): Promise<GitHubInitializationSession | undefined> {
    try {
      let snapshot = await controller.load();
      if (detectProjectInitialization(snapshot.files).kind !== 'maven') {
        controller.dispose();
        return undefined;
      }
      let disposed = false;
      const proposals = new WeakMap<ReviewedMavenImportPreview, ReviewedMavenImportPreview>();
      const active = () => {
        if (disposed) throw new Error('Project initialization is no longer active');
      };
      return {
        get snapshot() {
          return snapshot;
        },
        async prepare(profiles) {
          active();
          snapshot = await controller.load();
          active();
          const preview = await prepareGitHubInitialization(snapshot, profiles);
          active();
          // Keep reviewed write/precondition bytes independent of presentation state.
          proposals.set(preview, structuredClone(preview));
          return preview;
        },
        async save(preview) {
          active();
          const captured = proposals.get(preview);
          if (!captured) throw new Error('Review the proposed project settings before saving');
          return controller.save(captured.writes, captured.preconditions);
        },
        dispose() {
          disposed = true;
          controller.dispose();
        }
      };
    } catch (error) {
      controller.dispose();
      throw error;
    }
  },
  {
    op: 'createGitHubInitializationSession',
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);
