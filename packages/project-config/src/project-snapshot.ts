// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { projectSourcePaths } from './source-paths.js';
import { parseProjectLock } from './config-codec.js';
import { normalizeProjectPath, validateOutputPaths } from './output-paths.js';
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
  validateTarget: TargetValidator,
  revisions?: ReadonlyMap<string, string>
): Promise<ProjectSnapshot> {
  const project = normalizeProject(files, validateTarget);
  const diagnostics = project.diagnostics;
  let sources: string[] = [];
  try {
    sources = projectSourcePaths(files, project.build.sources);
  } catch (error) {
    diagnostics.push({ code: 'SOURCE_PATTERN', severity: 'error', path: 'sources', message: String(error) });
  }
  diagnostics.push(
    ...validateOutputPaths(project.build.targets, [
      ...project.build.sources,
      ...sources,
      ...project.build.resources.map((resource) => resource.path),
      project.build.runeConfig,
      'rune-config.yml',
      'rune-config.yaml',
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
  const ownedFiles = new Map([...files.keys()].sort().map((path) => [path, files.get(path)!]));
  const exactInputs = new Set([
    ...sources,
    project.build.runeConfig,
    'rune-config.yml',
    'rune-config.yaml',
    'build-config.yml',
    'build-config.yaml',
    'studio-config.yml',
    'studio-config.yaml',
    'build-config.lock.json'
  ]);
  const inputRoots = [
    ...project.build.resources.map((resource) => resource.path),
    project.studio.examples,
    project.studio.workflows,
    project.studio.layouts
  ]
    .map((path) => normalizeProjectPath(path))
    .filter((path): path is string => Boolean(path));
  const inputs = [...ownedFiles].filter(
    ([path]) => exactInputs.has(path) || inputRoots.some((root) => path === root || path.startsWith(root + '/'))
  );
  const inputRevisions = await Promise.all(
    inputs.map(async ([path, text]) => [path, revisions?.get(path) ?? (await projectFileRevision(text))] as const)
  );
  const fileRevisions = new Map(revisions);
  for (const [path, revision] of inputRevisions) fileRevisions.set(path, revision);
  return {
    workspaceId,
    revision: await projectFileRevision(JSON.stringify(inputRevisions)),
    fileRevisions,
    files: ownedFiles,
    project,
    ...(lock?.value ? { lock: lock.value } : {})
  };
}

/** Capture an unsaved editor generation while retaining raw identities of untouched resources. */
export async function createProjectDraftSnapshot(
  snapshot: ProjectSnapshot,
  edits: ReadonlyMap<string, string | null>,
  validateTarget: TargetValidator
): Promise<ProjectSnapshot> {
  const files = new Map(snapshot.files);
  const revisions = new Map(snapshot.fileRevisions);
  for (const [path, text] of edits) {
    if (normalizeProjectPath(path) !== path)
      throw new Error('Draft path must be portable and project-relative: ' + path);
    if (text === null) files.delete(path);
    else files.set(path, text);
    revisions.delete(path);
  }
  return createProjectSnapshot(snapshot.workspaceId, files, validateTarget, revisions);
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
  const snapshot = await createProjectSnapshot(
    input.workspaceId,
    captured.files,
    input.validateTarget,
    captured.revisions
  );
  await captured.verify();
  return snapshot;
}
