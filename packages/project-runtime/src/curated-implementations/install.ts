// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { z } from 'zod';
import { ImplementationSourcePackSchema } from '@rune-langium/core/project-contract';
import {
  canonicalProjectJson,
  normalizeProjectPath,
  prepareBuildConfigSave,
  projectFileRevision,
  projectSourcePaths,
  type ProjectSnapshot,
  type ProjectDiagnostic,
  saveProject,
  readProjectSnapshot,
  type ProjectFileAdapter,
  type TargetValidator,
  type ProjectChange
} from '@rune-langium/project-config';
import type { ReferenceDocument } from '../references/types.js';

export const IMPLEMENTATION_SOURCE_PROVENANCE = 'model/implementations/.curated-sources.json';
const provenanceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  files: z.record(
    z.string(),
    z.strictObject({
      model: z.string(),
      commit: z.string().regex(/^[a-f0-9]{40}$/),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      source: z.string(),
      owned: z.boolean()
    })
  )
});

/** Prepare ordinary workspace writes; callers commit them through their existing revisioned Save transaction. */
export async function prepareCuratedImplementationSources(
  snapshot: ProjectSnapshot,
  references: readonly ReferenceDocument[]
) {
  const desired = new Map<string, { content: string; origin: z.infer<typeof provenanceSchema>['files'][string] }>();
  const changes = new Map<string, string | null>();
  const diagnostics: ProjectDiagnostic[] = [];
  for (const reference of references) {
    if (!reference.serialized) continue;
    const root: unknown = JSON.parse(reference.serialized);
    if (!root || typeof root !== 'object' || !Reflect.has(root, '$implementationSources')) continue;
    const pack = ImplementationSourcePackSchema.parse(Reflect.get(root, '$implementationSources'));
    if (pack.model !== reference.source?.model || pack.commit !== reference.source.commit)
      throw new Error('Curated implementation source provenance differs from its verified reference bundle.');
    for (const file of pack.files) {
      const path = `model/implementations/${pack.model}/${file.path}`;
      if (normalizeProjectPath(path) !== path || (!file.path.endsWith('.rosetta') && file.path !== 'LICENSE'))
        throw new Error('Unsafe Rune implementation source path.');
      if ((await projectFileRevision(file.content)) !== file.sha256)
        throw new Error('Curated implementation source checksum mismatch: ' + path);
      const entry = {
        content: file.content,
        origin: { model: pack.model, commit: pack.commit, sha256: file.sha256, source: file.path, owned: true }
      };
      const prior = desired.get(path);
      if (prior && canonicalProjectJson(prior) !== canonicalProjectJson(entry))
        throw new Error('Conflicting curated implementation sources: ' + path);
      desired.set(path, entry);
    }
  }
  const previousText = snapshot.files.get(IMPLEMENTATION_SOURCE_PROVENANCE);
  const previous = previousText
    ? provenanceSchema.parse(JSON.parse(previousText))
    : { schemaVersion: 1 as const, files: {} };
  const next: z.infer<typeof provenanceSchema> = { schemaVersion: 1, files: {} };
  const warning = (path: string) =>
    diagnostics.push({
      code: 'IMPLEMENTATION_SOURCE_EDITED',
      severity: 'warning',
      path,
      message:
        'The workspace file was preserved because it is locally edited or was not installed by this curated bundle.'
    });
  for (const [path, entry] of desired) {
    const existing = snapshot.files.get(path),
      prior = previous.files[path];
    const unchanged = existing !== undefined && prior?.owned && (await projectFileRevision(existing)) === prior.sha256;
    if (existing === undefined && prior) {
      // A removed owned copy is an ordinary user deletion, not a request to reinstall it.
      warning(path);
      next.files[path] = prior;
    } else if (existing === undefined || unchanged) {
      if (existing !== entry.content) changes.set(path, entry.content);
      next.files[path] = entry.origin;
    } else if (existing === entry.content) {
      // Identical pre-existing user files are usable, but never become ours to remove.
      next.files[path] = { ...entry.origin, owned: prior?.owned ?? false };
    } else {
      warning(path);
      if (prior) next.files[path] = prior;
    }
  }
  for (const [path, prior] of Object.entries(previous.files)) {
    if (
      normalizeProjectPath(path) !== path ||
      !path.startsWith('model/implementations/') ||
      (!path.endsWith('.rosetta') && !/^model\/implementations\/[^/]+\/LICENSE$/.test(path))
    )
      throw new Error('Unsafe curated implementation provenance path.');
    if (desired.has(path) || !snapshot.files.has(path)) continue;
    if (prior.owned && (await projectFileRevision(snapshot.files.get(path)!)) === prior.sha256) changes.set(path, null);
    else {
      warning(path);
      next.files[path] = prior;
    }
  }
  if (Object.keys(next.files).length) {
    const text = JSON.stringify(next, null, 2) + '\n';
    if (previousText !== text) changes.set(IMPLEMENTATION_SOURCE_PROVENANCE, text);
  } else if (previousText !== undefined) changes.set(IMPLEMENTATION_SOURCE_PROVENANCE, null);
  const files = new Map(snapshot.files);
  for (const [path, content] of changes) {
    if (content === null) files.delete(path);
    else files.set(path, content);
  }
  const selected = new Set(projectSourcePaths(files, snapshot.project.build.sources));
  if ([...desired.keys()].some((path) => path.endsWith('.rosetta') && files.has(path) && !selected.has(path))) {
    const revisions = new Map(
      await Promise.all(
        [...snapshot.files]
          .filter(([path]) => /^build-config\.ya?ml$/.test(path))
          .map(async ([path, text]) => [path, await projectFileRevision(text)] as const)
      )
    );
    const prepared = prepareBuildConfigSave({
      files: snapshot.files,
      revisions,
      build: {
        ...snapshot.project.build,
        sources: [...snapshot.project.build.sources, 'model/implementations/**/*.rosetta']
      },
      modelName: 'Workspace'
    });
    diagnostics.push(...prepared.diagnostics);
    for (const write of prepared.writes) changes.set(write.path, write.text);
  }
  return { changes, diagnostics };
}

/** Native hosts install before generation, using the same compare-and-swap/readback transaction as Studio. */
export async function installCuratedImplementationSources(input: {
  snapshot: ProjectSnapshot;
  references: readonly ReferenceDocument[];
  adapter: ProjectFileAdapter;
  validateTarget: TargetValidator;
  signal?: AbortSignal;
}) {
  const { snapshot, adapter } = input;
  input.signal?.throwIfAborted();
  const prepared = await prepareCuratedImplementationSources(snapshot, input.references);
  if (prepared.diagnostics.some((issue) => issue.severity === 'error'))
    return { snapshot: undefined, diagnostics: prepared.diagnostics };
  if (!prepared.changes.size) return { snapshot, diagnostics: prepared.diagnostics };
  const transaction = await curatedImplementationWrites(snapshot, prepared.changes);
  input.signal?.throwIfAborted();
  const result = await saveProject(
    adapter,
    transaction.writes,
    'curated-implementations-' + crypto.randomUUID(),
    transaction.preconditions
  );
  if (result.status !== 'saved')
    return { snapshot: undefined, diagnostics: [...prepared.diagnostics, ...result.diagnostics] };
  return {
    snapshot: await readProjectSnapshot({
      workspaceId: snapshot.workspaceId,
      adapter,
      validateTarget: input.validateTarget
    }),
    diagnostics: prepared.diagnostics
  };
}

/** Hosts share exact base-file preconditions even when planning against live, unsaved editor text. */
export async function curatedImplementationWrites(
  snapshot: ProjectSnapshot,
  changes: ReadonlyMap<string, string | null>
) {
  const writes: ProjectChange[] = [];
  for (const [path, text] of changes) {
    const previous = snapshot.files.get(path);
    const revision = previous === undefined ? null : await projectFileRevision(previous);
    if (text !== null) writes.push({ path, text, expectedRevision: revision });
    else if (revision !== null) writes.push({ path, remove: true, expectedRevision: revision });
  }
  const inputs = await Promise.all(
    [...snapshot.files]
      .filter(([path]) => !changes.has(path))
      .map(async ([path, text]) => ({
        path,
        revision: snapshot.fileRevisions.get(path) ?? (await projectFileRevision(text))
      }))
  );
  return { writes, preconditions: { paths: [...snapshot.files.keys()], inputs } };
}
