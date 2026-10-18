// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/* eslint-disable @typescript-eslint/no-redundant-type-constituents */
const currentDir = dirname(fileURLToPath(import.meta.url));
// .resources/ lives at the monorepo root
const FIXTURES_DIR = resolve(currentDir, '../../../../.resources');

/**
 * Load a single fixture file by relative path.
 *
 * @param relativePath - Path relative to the fixtures directory (e.g., 'cdm/types.rosetta')
 * @returns The file contents as a string.
 */
export async function loadFixture(relativePath: string): Promise<string> {
  const filePath = join(FIXTURES_DIR, relativePath);
  return readFile(filePath, 'utf-8');
}

/**
 * List all `.rosetta` files in a fixture subdirectory.
 *
 * @param subdir - Subdirectory name (e.g., 'cdm' or 'rune-dsl')
 * @returns Array of filenames (not full paths).
 */
export async function listFixtures(subdir: string): Promise<string[]> {
  const dirPath = join(FIXTURES_DIR, subdir);
  try {
    const entries = await readdir(dirPath);
    return entries.filter((f) => f.endsWith('.rosetta')).sort();
  } catch {
    return [];
  }
}

/**
 * Load all `.rosetta` files from a fixture subdirectory.
 *
 * @param subdir - Subdirectory name (e.g., 'cdm' or 'rune-dsl')
 * @returns Array of `{ name, content }` objects.
 */
export async function loadAllFixtures(subdir: string): Promise<Array<{ name: string; content: string }>> {
  const filenames = await listFixtures(subdir);
  return Promise.all(
    filenames.map(async (name) => ({
      name,
      content: await loadFixture(join(subdir, name))
    }))
  );
}

/**
 * Read the pinned version tag for a fixture set.
 *
 * @param subdir - Subdirectory name (e.g., 'cdm' or 'rune-dsl')
 * @returns The version string, or undefined if not yet vendored.
 */
export async function fixtureVersion(subdir: string): Promise<string | undefined> {
  try {
    const content = await readFile(join(FIXTURES_DIR, subdir, '.version'), 'utf-8');
    return content.trim();
  } catch {
    return undefined;
  }
}

/** Load the complete dependency workspace; a missing corpus must not shrink coverage. */
export async function loadCorpusFixtures() {
  return Promise.all(
    ['rune-dsl', 'rune-fpml', 'cdm'].map(async (corpus) => {
      const files = await loadAllFixtures(corpus);
      if (!files.length) throw new Error(`Missing ${corpus} corpus fixtures; run scripts/update-fixtures.sh`);
      return { corpus, version: await fixtureVersion(corpus), files };
    })
  );
}
