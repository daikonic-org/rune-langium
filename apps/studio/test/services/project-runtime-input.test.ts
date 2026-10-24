// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { it, expect } from 'vitest';
import { createProjectSnapshot } from '@rune-langium/project-config';
import { captureProjectRuntimeInput } from '../../src/services/project-runtime-input.js';
import { URI } from 'langium';
import { pathToUri } from '../../src/utils/uri.js';
it('captures live source ownership and a matching receipt without changing the saved snapshot', async () => {
  const saved = await createProjectSnapshot(
    'p',
    new Map([
      ['rune-config.yml', 'model: {name: Demo}'],
      ['build-config.yml', 'schemaVersion: 1'],
      ['model/a.rosetta', 'namespace before']
    ]),
    () => []
  );
  const references = [{ uri: 'cdm/definitions.rosetta', content: 'namespace upstream' }];
  const input = await captureProjectRuntimeInput(
    saved,
    [
      { path: 'model/a.rosetta', name: 'a.rosetta', content: 'namespace after', dirty: true },
      {
        path: '[cdm]/definitions.rosetta',
        name: 'definitions.rosetta',
        content: 'namespace hidden',
        readOnly: true,
        dirty: false
      }
    ],
    references
  );
  expect(input.snapshot.revision).not.toBe(saved.revision);
  expect(saved.files.get('model/a.rosetta')).toBe('namespace before');
  expect(input.snapshot.files.get('model/a.rosetta')).toBe('namespace after');
  expect(input.receipt.revision).toBe(input.snapshot.revision);
  expect(input.resolution.models[URI.parse(pathToUri('model/a.rosetta')).toString()]).toBe('local');
  expect(input.resolution.models[URI.parse(pathToUri('[cdm]/definitions.rosetta')).toString()]).toBe('cdm');
  expect(input.referenceDocuments).toEqual(references);
  expect(input.snapshot.files.has('[cdm]/definitions.rosetta')).toBe(false);
});
it('captures deleted source files and ignores sources outside configured scopes', async () => {
  const saved = await createProjectSnapshot(
    'p',
    new Map([
      ['rune-config.yml', 'model: {name: Demo}'],
      ['build-config.yml', 'schemaVersion: 1'],
      ['model/deleted.rosetta', 'namespace before']
    ]),
    () => []
  );
  const input = await captureProjectRuntimeInput(
    saved,
    [
      { path: 'model/added.rosetta', name: 'added.rosetta', content: 'namespace added', dirty: true },
      { path: 'scratch/outside.rosetta', name: 'outside.rosetta', content: 'namespace outside', dirty: true }
    ],
    []
  );
  expect(input.snapshot.files.has('model/deleted.rosetta')).toBe(false);
  expect(Object.keys(input.resolution.models)).toEqual([URI.parse(pathToUri('model/added.rosetta')).toString()]);
});
