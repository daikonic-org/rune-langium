// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

export const PROJECT_SAVE_JOURNAL_PATH = '.studio/project-save/journal.json';

export interface ProjectFileAdapter {
  read(path: string): Promise<{ text: string; revision: string } | undefined>;
  /** A null revision requires the destination to be absent. */
  write(path: string, text: string, expectedRevision: string | null): Promise<string>;
  remove(path: string, expectedRevision: string): Promise<void>;
  /** Repository files only; exclude backing-private state and credentials. */
  list(): Promise<string[]>;
}

export interface ProjectWrite {
  path: string;
  text: string;
  expectedRevision: string | null;
}

export class ProjectFileConflict extends Error {
  constructor(readonly path: string) {
    super(`Project file changed: ${path}`);
    this.name = 'ProjectFileConflict';
  }
}
