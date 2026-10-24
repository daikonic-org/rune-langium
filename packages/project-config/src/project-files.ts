// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

export const PROJECT_SAVE_JOURNAL_PATH = '.studio/project-save/journal.json';

/** Entries outside repository-managed project capture, at any nesting level. */
export function isIgnoredProjectEntry(name: string): boolean {
  return /^\.(git|studio)$/i.test(name) || name === 'node_modules';
}

/** Content identity shared by browser and Node project hosts. */
export async function projectFileRevision(text: string): Promise<string> {
  return projectBytesRevision(new TextEncoder().encode(text));
}

export async function projectBytesRevision(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface ProjectFileAdapter {
  read(path: string): Promise<{ text: string; revision: string } | undefined>;
  /** A null revision requires the destination to be absent. */
  write(path: string, text: string, expectedRevision: string | null): Promise<string>;
  /** Hosts supporting binary generators must preserve their bytes without text encoding. */
  writeBinary?(path: string, bytes: Uint8Array, expectedRevision: string | null): Promise<string>;
  remove(path: string, expectedRevision: string): Promise<void>;
  /** Repository files only; exclude backing-private state and credentials. */
  list(): Promise<string[]>;
}

export interface ProjectWrite {
  path: string;
  text: string;
  expectedRevision: string | null;
}

/** An explicit removal uses the same compare-and-swap/readback contract as writes. */
export interface ProjectRemoval {
  path: string;
  remove: true;
  expectedRevision: string;
}
export type ProjectChange = ProjectWrite | ProjectRemoval;

export class ProjectFileConflict extends Error {
  constructor(readonly path: string) {
    super(`Project file changed: ${path}`);
    this.name = 'ProjectFileConflict';
  }
}
