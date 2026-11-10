// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface ReferenceCase {
  id: string;
  function: string;
  inputs: Record<string, unknown>;
  features: string[];
  expected?: unknown;
  knownDifference?: { expectedRune: unknown; reason: string; source: string };
  expectedError?: string;
  absoluteTolerance?: number;
}

const directory = resolve(import.meta.dirname, '../fixtures/cdm-reference');
export const referenceCases: ReferenceCase[] = JSON.parse(readFileSync(resolve(directory, 'cases.json'), 'utf8'));

/** Read pinned upstream slices with their recorded integrity checks. */
export function referenceFiles(fixtureDirectory = directory) {
  const manifest: { files: { name: string; sha256: string; sharedFixture?: string }[] } = JSON.parse(
    readFileSync(resolve(fixtureDirectory, 'sources.json'), 'utf8')
  );
  return manifest.files.map(({ name, sha256, sharedFixture }) => {
    const sourceDirectory = sharedFixture ? resolve(fixtureDirectory, '..', sharedFixture) : fixtureDirectory;
    const content = readFileSync(resolve(sourceDirectory, name), 'utf8');
    if (createHash('sha256').update(content).digest('hex') !== sha256) throw new Error(`CDM fixture changed: ${name}`);
    return { uri: `file:///cdm-reference/${name}`, content };
  });
}

export function expressionReferenceFiles() {
  return referenceFiles(resolve(import.meta.dirname, '../../../../test/fixtures/third-party/cdm-expression'));
}

/** Retain pinned model ownership when publishing a multi-document test bundle. */
export function referenceModelSources(fixtureDirectory: string) {
  const manifest: { files: { name: string; upstream: { model: string } }[] } = JSON.parse(
    readFileSync(resolve(fixtureDirectory, 'sources.json'), 'utf8')
  );
  const files = referenceFiles(fixtureDirectory);
  return Object.fromEntries(
    [...new Set(manifest.files.map((file) => file.upstream.model))].map((model) => [
      model,
      manifest.files.flatMap((file, index) =>
        file.upstream.model === model ? [{ path: file.name, content: files[index]!.content }] : []
      )
    ])
  );
}
