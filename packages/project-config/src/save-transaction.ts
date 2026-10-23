// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { z } from 'zod';
import { normalizeProjectPath } from './output-paths.js';
import {
  PROJECT_SAVE_JOURNAL_PATH as JOURNAL_PATH,
  ProjectFileConflict,
  type ProjectFileAdapter,
  type ProjectWrite
} from './project-files.js';
import type { ProjectDiagnostic } from './types.js';

const JournalSchema = z.strictObject({
  schemaVersion: z.literal(1),
  operationId: z.string().min(1),
  writes: z.array(
    z.strictObject({
      path: z.string(),
      text: z.string(),
      expectedRevision: z.string().nullable(),
      appliedRevision: z.string().optional()
    })
  )
});
type Journal = z.infer<typeof JournalSchema>;
export interface ProjectSaveResult {
  status: 'saved' | 'conflict' | 'recoverable';
  diagnostics: ProjectDiagnostic[];
}

function checkedWrites(writes: readonly ProjectWrite[]): ProjectWrite[] {
  const paths = new Set<string>();
  return writes.map((write) => {
    const path = normalizeProjectPath(write.path);
    const key = path?.toLowerCase();
    if (!path || !key || /^(\.git|\.studio)(\/|$)/i.test(path) || paths.has(key))
      throw new ProjectFileConflict(write.path);
    paths.add(key);
    return { ...write, path };
  });
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
    if (file?.text !== write.text || (write.appliedRevision && file.revision !== write.appliedRevision))
      throw new ProjectFileConflict(write.path);
  }
}

/** Complete a prepared operation, retaining its journal on partial writes. */
async function commit(adapter: ProjectFileAdapter, journal: Journal, revision: string): Promise<void> {
  // Check the entire operation before resuming; do not partially replay over
  // a third-party change discovered in a later file.
  for (const write of journal.writes) {
    const file = await adapter.read(write.path);
    if (write.appliedRevision) {
      if (file?.revision !== write.appliedRevision || file.text !== write.text)
        throw new ProjectFileConflict(write.path);
    } else if ((file?.revision ?? null) !== write.expectedRevision && file?.text !== write.text) {
      throw new ProjectFileConflict(write.path);
    }
  }
  for (const write of journal.writes) {
    if (write.appliedRevision) continue;
    const file = await adapter.read(write.path);
    // A crash can occur after a data write but before the journal update.
    // Exact proposed bytes allow recovery without rewriting that file.
    if (file?.text === write.text) write.appliedRevision = file.revision;
    else write.appliedRevision = await adapter.write(write.path, write.text, write.expectedRevision);
    revision = await adapter.write(JOURNAL_PATH, JSON.stringify(journal), revision);
  }
  await verify(adapter, journal.writes);
  await adapter.remove(JOURNAL_PATH, revision);
  await verify(adapter, journal.writes);
}

/** Success means all bytes were read back; it does not claim filesystem atomicity. */
export async function saveProject(
  adapter: ProjectFileAdapter,
  writes: readonly ProjectWrite[],
  operationId: string
): Promise<ProjectSaveResult> {
  try {
    const normalized = checkedWrites(writes);
    const journal = JournalSchema.parse({ schemaVersion: 1, operationId, writes: normalized });
    if (await adapter.read(JOURNAL_PATH)) throw new ProjectFileConflict(JOURNAL_PATH);
    // Validate every expected revision before publishing the durable prepare.
    for (const write of normalized) {
      const file = await adapter.read(write.path);
      if ((file?.revision ?? null) !== write.expectedRevision && file?.text !== write.text)
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
    checkedWrites(journal.writes);
    await commit(adapter, journal, file.revision);
    return [];
  } catch (error) {
    return failed(error).diagnostics;
  }
}
