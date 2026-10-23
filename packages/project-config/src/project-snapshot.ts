// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { parseProjectLock } from './config-codec.js';
import { validateOutputPaths } from './output-paths.js';
import {
  PROJECT_SAVE_JOURNAL_PATH,
  ProjectFileConflict,
  projectFileRevision,
  type ProjectFileAdapter
} from './project-files.js';
import { normalizeProject } from './rune-compat.js';
import type { ProjectDiagnostic, ProjectFiles, ProjectSnapshot, TargetValidator } from './types.js';

export class ProjectSnapshotError extends Error {
  constructor(readonly diagnostics: readonly ProjectDiagnostic[]) {
    super(diagnostics[0]?.message ?? 'Project snapshot is unavailable');
    this.name = 'ProjectSnapshotError';
  }
}

/** Global errors block every run; target errors block only explicitly selected targets. */
export function projectDiagnosticsForTargets(
  diagnostics: readonly ProjectDiagnostic[],
  targets: readonly string[] = []
): ProjectDiagnostic[] {
  return diagnostics.filter((issue) => !issue.target || targets.includes(issue.target));
}

/** Shared validation for proposed edits, Studio activation and headless builds. */
export async function createProjectSnapshot(
  workspaceId: string,
  files: ProjectFiles,
  validateTarget: TargetValidator
): Promise<ProjectSnapshot> {
  const project = normalizeProject(files, validateTarget);
  const diagnostics = project.diagnostics;
  diagnostics.push(
    ...validateOutputPaths(project.build.targets, [
      ...project.build.sources,
      ...[...files.keys()].filter((path) => path.endsWith('.rosetta')),
      ...project.build.resources.map((resource) => resource.path),
      project.build.runeConfig,
      'build-config.yml',
      'build-config.yaml',
      'studio-config.yml',
      'studio-config.yaml',
      'build-config.lock.json',
      project.studio.examples,
      project.studio.workflows,
      project.studio.layouts
    ])
  );
  const lockText = files.get('build-config.lock.json');
  const lock =
    lockText === undefined ? undefined : parseProjectLock({ path: 'build-config.lock.json', text: lockText });
  diagnostics.push(...(lock?.diagnostics ?? []));
  if (projectDiagnosticsForTargets(diagnostics).some((issue) => issue.severity === 'error'))
    throw new ProjectSnapshotError(diagnostics);
  const ownedFiles = new Map([...files].sort(([left], [right]) => left.localeCompare(right)));
  return {
    workspaceId,
    revision: await projectFileRevision(JSON.stringify([...ownedFiles])),
    files: ownedFiles,
    project,
    ...(lock?.value ? { lock: lock.value } : {})
  };
}

/** Raw files remain editable even while their configuration is invalid. */
export async function readProjectFiles(adapter: ProjectFileAdapter): Promise<{
  files: ProjectFiles;
  revisions: ReadonlyMap<string, string>;
  verify(): Promise<void>;
}> {
  if (await adapter.read(PROJECT_SAVE_JOURNAL_PATH)) throw new ProjectFileConflict(PROJECT_SAVE_JOURNAL_PATH);
  const paths = (await adapter.list()).sort();
  const files = new Map<string, string>();
  const revisions = new Map<string, string>();
  for (const path of paths) {
    const file = await adapter.read(path);
    if (!file) throw new ProjectFileConflict(path);
    files.set(path, file.text);
    revisions.set(path, file.revision);
  }
  return {
    files,
    revisions,
    async verify() {
      if (JSON.stringify((await adapter.list()).sort()) !== JSON.stringify(paths)) throw new ProjectFileConflict('');
      for (const [path, revision] of revisions)
        if ((await adapter.read(path))?.revision !== revision) throw new ProjectFileConflict(path);
      if (await adapter.read(PROJECT_SAVE_JOURNAL_PATH)) throw new ProjectFileConflict(PROJECT_SAVE_JOURNAL_PATH);
    }
  };
}

/** Read twice around validation so a torn working-copy read is never published. */
export async function readProjectSnapshot(input: {
  workspaceId: string;
  adapter: ProjectFileAdapter;
  validateTarget: TargetValidator;
}): Promise<ProjectSnapshot> {
  const captured = await readProjectFiles(input.adapter);
  const snapshot = await createProjectSnapshot(input.workspaceId, captured.files, input.validateTarget);
  await captured.verify();
  return snapshot;
}
