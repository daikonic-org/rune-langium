// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { it, expect, vi } from 'vitest';
import { parse, createRuneDslServices, serializeRuneModel } from '@rune-langium/core';
import { EmptyFileSystem } from 'langium';
import {
  createMemoryReferenceCache,
  resolveProjectReferences,
  loadLockedReferences
} from '@rune-langium/project-runtime/references';
import { createReferenceArtifacts } from '../../../../test/helpers/project-reference-artifacts.js';
import { captureProjectRuntimeInput } from '../../src/services/project-runtime-input.js';
import { prepareProjectReferenceView } from '../../src/services/project-reference-view.js';
import { workspaceDeclarationIdentities } from '../../src/workspace/example-identity.js';
it('projects exact locked ASTs into Explorer and parser hydration without a latest-model request', async () => {
  const fixture = await createReferenceArtifacts(undefined, undefined, {
    cdm: 'namespace pinned\ntype Payment:\n amount number (1..1)',
    'rune-dsl': 'namespace pinned.base\ntype Support:\n name string (0..1)'
  });
  const cache = createMemoryReferenceCache();
  const { lock } = await resolveProjectReferences(
    fixture.snapshot,
    fixture.transport,
    new AbortController().signal,
    cache
  );
  const snapshot = { ...fixture.snapshot, lock: lock! };
  const loaded = await loadLockedReferences(lock!, fixture.transport, cache, new AbortController().signal);
  const file = {
    path: 'main.rosetta',
    name: 'main.rosetta',
    content: 'namespace local\ntype Draft:\n value number (0..1)',
    dirty: false
  };
  const parsed = await parse(file.content, 'file:///workspace/main.rosetta');
  const services = createRuneDslServices(EmptyFileSystem);
  const state = {
    workspaceId: 'p',
    fileCount: 1,
    files: [file],
    models: [parsed.value!],
    parsedModels: [
      {
        filePath: file.path,
        model: parsed.value!,
        source: file.content,
        serializedModelJson: serializeRuneModel(services.RuneDsl.serializer.JsonSerializer, parsed.value!)
      }
    ],
    deferredExports: [],
    parseErrors: new Map()
  };
  const input = await captureProjectRuntimeInput(snapshot, [file], loaded.documents);
  const install = vi.fn().mockResolvedValue(undefined);
  const view = await prepareProjectReferenceView(input, state, install, new AbortController().signal);
  expect(view.files.find((file) => file.bundleId === 'cdm')).toMatchObject({
    path: '[cdm]/model.rosetta',
    readOnly: true,
    refOnly: true,
    sourceLoaded: true
  });
  expect(workspaceDeclarationIdentities(view)).toContainEqual({
    model: 'cdm',
    namespace: 'pinned',
    kind: 'Data',
    name: 'Payment'
  });
  expect(install).toHaveBeenCalledOnce();
  expect(install.mock.calls[0]![0]).toEqual(
    expect.arrayContaining([expect.objectContaining({ uri: 'file:///[cdm]/model.rosetta' })])
  );
});
