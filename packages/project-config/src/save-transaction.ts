// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { z } from 'zod';
import { normalizeProjectPath } from './output-paths.js';
import {
  PROJECT_SAVE_JOURNAL_PATH as JOURNAL_PATH,
  ProjectFileConflict,
  type ProjectFileAdapter,
  type ProjectChange
} from './project-files.js';
import type { ProjectDiagnostic } from './types.js';

const PreconditionsSchema = z.strictObject({
  inputs: z.array(z.strictObject({ path: z.string(), revision: z.string().nullable() })).optional(),
  paths: z.array(z.string()).optional()
});

/** Read-only evidence used to prepare a reviewed Save. Never written by the operation. */
export interface ProjectSavePreconditions {
  inputs?: readonly { path: string; revision: string | null }[];
  /** Exact repository file list at review time, before adding proposed destinations. */
  paths?: readonly string[];
}

const JournalSchema = z.strictObject({
  schemaVersion: z.literal(1),
  operationId: z.string().min(1),
  preconditions: PreconditionsSchema.optional(),
  writes: z.array(
    z.union([
      z.strictObject({
        path: z.string(),
        text: z.string(),
        expectedRevision: z.string().nullable(),
        appliedRevision: z.string().optional()
      }),
      z.strictObject({
        path: z.string(),
        remove: z.literal(true),
        expectedRevision: z.string(),
        applied: z.literal(true).optional()
      })
    ])
  )
});
type Journal = z.infer<typeof JournalSchema>;
export interface ProjectSaveResult {
  status: 'saved' | 'conflict' | 'recoverable';
  diagnostics: ProjectDiagnostic[];
}

function checkedPaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  return paths.map((original) => {
    const path = normalizeProjectPath(original);
    const key = path?.toLowerCase();
    if (!path || !key || /^(\.git|\.studio)(\/|$)/i.test(path) || seen.has(key))
      throw new ProjectFileConflict(original);
    seen.add(key);
    return path;
  });
}

function checkedChanges(writes: readonly ProjectChange[]): ProjectChange[] {
  const paths = checkedPaths(writes.map((write) => write.path));
  return writes.map((write, i) => ({ ...write, path: paths[i]! }));
}

function checkedPreconditions(
  writes: readonly ProjectChange[],
  preconditions: ProjectSavePreconditions | undefined
): Journal['preconditions'] {
  if (!preconditions) return undefined;
  const inputs = preconditions.inputs?.map((input) => ({ ...input }));
  if (inputs) {
    const paths = checkedPaths(inputs.map((input) => input.path));
    const destinations = new Set(writes.map((write) => write.path.toLowerCase()));
    inputs.forEach((input, i) => {
      input.path = paths[i]!;
      if (destinations.has(input.path.toLowerCase())) throw new ProjectFileConflict(input.path);
    });
  }
  return PreconditionsSchema.parse({
    inputs,
    paths: preconditions.paths === undefined ? undefined : checkedPaths(preconditions.paths)
  });
}

async function verifyInputs(adapter: ProjectFileAdapter, journal: Journal, prepared: boolean): Promise<void> {
  const conditions = journal.preconditions;
  if (!conditions) return;
  if (conditions.paths) {
    const actual = new Set(await adapter.list());
    const expected = new Set(conditions.paths);
    const allowed = new Set(expected);
    if (prepared) for (const write of journal.writes) if ('remove' in write) expected.delete(write.path);
    if (prepared) for (const write of journal.writes) allowed.add(write.path);
    for (const path of actual) if (!allowed.has(path)) throw new ProjectFileConflict(path);
    for (const path of expected) if (!actual.has(path)) throw new ProjectFileConflict(path);
  }
  for (const input of conditions.inputs ?? []) {
    const file = await adapter.read(input.path);
    if ((file?.revision ?? null) !== input.revision) throw new ProjectFileConflict(input.path);
  }
}

function failed(error: unknown): ProjectSaveResult {
  const conflict = error instanceof ProjectFileConflict;
  return {
    status: conflict ? 'conflict' : 'recoverable',
    diagnostics: [
      {
        code: conflict ? 'SAVE_CONFLICT' : 'SAVE_UNAVAILABLE',
        severity: 'error',
        path: conflict ? error.path : JOURNAL_PATH,
        message: conflict
          ? 'A project file changed. Review the working copy before retrying Save.'
          : 'Project Save was interrupted. Restore access and retry recovery.'
      }
    ]
  };
}

async function verify(adapter: ProjectFileAdapter, writes: Journal['writes']): Promise<void> {
  for (const write of writes) {
    const file = await adapter.read(write.path);
    if ('remove' in write) {
      if (file) throw new ProjectFileConflict(write.path);
    } else if (file?.text !== write.text || (write.appliedRevision && file.revision !== write.appliedRevision))
      throw new ProjectFileConflict(write.path);
  }
}

/** Complete a prepared operation, retaining its journal on partial writes. */
async function commit(adapter: ProjectFileAdapter, journal: Journal, revision: string): Promise<void> {
  await verifyInputs(adapter, journal, true);
  // Check the entire operation before resuming; do not partially replay over
  // a third-party change discovered in a later file.
  for (const write of journal.writes) {
    const file = await adapter.read(write.path);
    if ('remove' in write) {
      if (file && (write.applied || file.revision !== write.expectedRevision))
        throw new ProjectFileConflict(write.path);
    } else if (write.appliedRevision) {
      if (file?.revision !== write.appliedRevision || file.text !== write.text)
        throw new ProjectFileConflict(write.path);
    } else if ((file?.revision ?? null) !== write.expectedRevision && file?.text !== write.text) {
      throw new ProjectFileConflict(write.path);
    }
  }
  for (const write of journal.writes) {
    await verifyInputs(adapter, journal, true);
    if ('remove' in write) {
      if (write.applied) continue;
      if (await adapter.read(write.path)) await adapter.remove(write.path, write.expectedRevision);
      write.applied = true;
    } else {
      if (write.appliedRevision) continue;
      const file = await adapter.read(write.path);
      // Exact proposed bytes also recover a crash before the journal update.
      if (file?.text === write.text) write.appliedRevision = file.revision;
      else write.appliedRevision = await adapter.write(write.path, write.text, write.expectedRevision);
    }
    revision = await adapter.write(JOURNAL_PATH, JSON.stringify(journal), revision);
  }
  await verify(adapter, journal.writes);
  await verifyInputs(adapter, journal, true);
  await adapter.remove(JOURNAL_PATH, revision);
  await verify(adapter, journal.writes);
  await verifyInputs(adapter, journal, true);
}

/** Success means all bytes were read back; it does not claim filesystem atomicity. */
export async function saveProject(
  adapter: ProjectFileAdapter,
  writes: readonly ProjectChange[],
  operationId: string,
  preconditions?: ProjectSavePreconditions
): Promise<ProjectSaveResult> {
  try {
    const normalized = checkedChanges(writes);
    const journal = JournalSchema.parse({
      schemaVersion: 1,
      operationId,
      writes: normalized,
      preconditions: checkedPreconditions(normalized, preconditions)
    });
    if (await adapter.read(JOURNAL_PATH)) throw new ProjectFileConflict(JOURNAL_PATH);
    await verifyInputs(adapter, journal, false);
    // Validate every expected revision before publishing the durable prepare.
    for (const write of normalized) {
      const file = await adapter.read(write.path);
      if ('remove' in write) {
        if (file && file.revision !== write.expectedRevision) throw new ProjectFileConflict(write.path);
      } else if ((file?.revision ?? null) !== write.expectedRevision && file?.text !== write.text)
        throw new ProjectFileConflict(write.path);
    }
    const revision = await adapter.write(JOURNAL_PATH, JSON.stringify(journal), null);
    await commit(adapter, journal, revision);
    return { status: 'saved', diagnostics: [] };
  } catch (error) {
    return failed(error);
  }
}

/** Host must own the workspace before invoking recovery on reopen/retry. */
export async function recoverProjectSave(adapter: ProjectFileAdapter): Promise<ProjectDiagnostic[]> {
  try {
    const file = await adapter.read(JOURNAL_PATH);
    if (!file) return [];
    const journal = JournalSchema.parse(JSON.parse(file.text));
    journal.writes = checkedChanges(journal.writes);
    journal.preconditions = checkedPreconditions(journal.writes, journal.preconditions);
    await commit(adapter, journal, file.revision);
    return [];
  } catch (error) {
    return failed(error).diagnostics;
  }
}
