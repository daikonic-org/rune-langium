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
import { createProjectSnapshot } from '@rune-langium/project-config';
import { createProjectFileAdapter } from '../../src/workspace/project-file-adapter.js';
import { loadWorkspaceFiles, saveWorkspaceFiles, setWorkspaceFilesDeps } from '../../src/workspace/workspace-files.js';
import { createOpfsRoot, writeBytes } from '../setup/opfs-mock.js';
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

it('preserves excluded Rune files through a bound-folder edit and autosave while excluding them from semantic hydration', async () => {
  const fixture = await createReferenceArtifacts(undefined, undefined, {
    cdm: 'namespace pinned\ntype Payment:\n amount number (1..1)',
    'rune-dsl': 'namespace pinned.base\ntype Support:\n name string (0..1)'
  });
  const root = createOpfsRoot();
  const privateRoot = createOpfsRoot();
  const id = 'excluded-sources';
  const source = 'namespace local\ntype Draft:\n value number (0..1)';
  const excluded = 'namespace scratch\ntype Unselected:\n name string (0..1)';
  const files = new Map(fixture.snapshot.files);
  files.set('build-config.yml', JSON.stringify({ ...fixture.snapshot.project.build, sources: ['model/**/*.rosetta'] }));
  files.set('model/main.rosetta', source);
  files.set('scratch/excluded.rosetta', excluded);
  const snapshot = await createProjectSnapshot(id, files, () => []);
  for (const [path, content] of files) await writeBytes(root, new TextEncoder().encode(content), ...path.split('/'));
  const adapter = createProjectFileAdapter({
    workspaceId: id,
    root: root as unknown as FileSystemDirectoryHandle,
    privateRoot: privateRoot as unknown as FileSystemDirectoryHandle,
    isWritable: () => true
  });
  setWorkspaceFilesDeps({ getFolderProjectAdapter: async (workspace) => (workspace === id ? adapter : undefined) });
  try {
    const writable = await loadWorkspaceFiles(id);
    const cache = createMemoryReferenceCache();
    const { lock } = await resolveProjectReferences(snapshot, fixture.transport, new AbortController().signal, cache);
    const loaded = await loadLockedReferences(lock!, fixture.transport, cache, new AbortController().signal);
    const parsed = await parse(source, 'file:///workspace/model/main.rosetta');
    const services = createRuneDslServices(EmptyFileSystem);
    const state = {
      workspaceId: id,
      fileCount: writable.length,
      files: writable,
      models: [parsed.value!],
      parsedModels: [
        {
          filePath: 'model/main.rosetta',
          model: parsed.value!,
          source,
          serializedModelJson: serializeRuneModel(services.RuneDsl.serializer.JsonSerializer, parsed.value!)
        }
      ],
      deferredExports: [],
      parseErrors: new Map()
    };
    const input = await captureProjectRuntimeInput({ ...snapshot, lock: lock! }, writable, loaded.documents);
    const install = vi.fn().mockResolvedValue(undefined);
    const view = await prepareProjectReferenceView(input, state, install, new AbortController().signal);
    await saveWorkspaceFiles(
      id,
      view.files.map((file) =>
        file.path === 'model/main.rosetta' ? { ...file, content: source + '\n// edited', dirty: true } : file
      )
    );
    expect((await adapter.read('scratch/excluded.rosetta'))?.text).toBe(excluded);
    expect((await adapter.read('model/main.rosetta'))?.text).toContain('// edited');
    expect(view.files.find((file) => file.path === 'scratch/excluded.rosetta')?.content).toBe(excluded);
    expect(view.models.map((model) => model.name)).not.toContain('scratch');
    expect(install.mock.calls[0]![0].some((document: { uri: string }) => document.uri.includes('excluded'))).toBe(
      false
    );
    expect(view.files.find((file) => file.bundleId === 'cdm')?.namespace).toBe('pinned');
  } finally {
    setWorkspaceFilesDeps({ getFolderProjectAdapter: undefined });
  }
});
