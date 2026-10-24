// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { beforeEach, expect, it, vi } from 'vitest';
import { EmptyFileSystem, URI } from 'langium';
import { createRuneDslServices, isRosettaModel, isRosettaExternalFunction } from '@rune-langium/core';
import { BASE_TYPE_FILES } from '../../src/resources/base-types.js';
import { collectRawWorkspaceSources } from '../../src/services/workspace.js';
import { generateExport } from '../../src/services/export-request.js';

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock('../../src/services/codegen-download-client.js', () => ({ requestCodegenDownload: requestMock }));

beforeEach(() => {
  requestMock.mockReset().mockImplementation(async (body) => {
    const { handleCodegenDownload } = await import('../../src/services/codegen-download-handler.js');
    const { project, ...payload } = body;
    return handleCodegenDownload({
      project,
      request: new Request('https://example.com/api/codegen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
    } as never);
  });
});

it.each(['typescript', 'zod', 'json-schema'] as const)(
  'exports every visible built-in declaration to %s',
  async (target) => {
    const { RuneDsl } = createRuneDslServices(EmptyFileSystem);
    const declarations = BASE_TYPE_FILES.flatMap((file) => {
      const model = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(file.content, URI.parse(file.path))
        .parseResult.value;
      if (!isRosettaModel(model)) throw new Error('Expected standard library model');
      return model.elements
        .filter((element) => !isRosettaExternalFunction(element))
        .map((element) => ({
          namespace: model.name,
          name: element.name,
          kind: element.$type
        }));
    });
    expect(declarations).toHaveLength(22);
    const artifact = await generateExport(
      {
        workspaceId: 'blank',
        sourceRevision: 1,
        files: [
          ...BASE_TYPE_FILES,
          { name: 'blank.rosetta', path: 'blank.rosetta', content: 'namespace example', dirty: false }
        ],
        config: { target, selection: { namespaces: [], declarations }, options: {} }
      },
      new AbortController().signal
    );
    expect(artifact.manifest.resolvedSelection?.explicit).toEqual(expect.arrayContaining(declarations));
    expect(artifact.manifest.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
  }
);

it('keeps read-only raw source while excluding curated transport entries', () => {
  const user = { name: 'trade.rosetta', path: 'trade.rosetta', content: 'namespace example', dirty: false };
  const files = [
    ...BASE_TYPE_FILES,
    user,
    { ...user, path: '[cdm]/.bundle-marker', bundleId: 'cdm', content: '' },
    { ...user, path: '[cdm]/model.rosetta', serializedModelJson: '{}', readOnly: true },
    { ...user, path: '[cdm]/deferred', refOnly: true }
  ];
  expect(collectRawWorkspaceSources(files)).toEqual(
    [...BASE_TYPE_FILES, user].map(({ path, content }) => ({ path, content }))
  );
});

it('uses library defaults for saved project builds rather than Pages layout opinions', async () => {
  const artifact = await generateExport(
    {
      workspaceId: 'test',
      sourceRevision: 1,
      projectBuild: true,
      files: [
        {
          path: 'test.rosetta',
          name: 'test.rosetta',
          content: 'namespace test\ntype Party:\n name string (1..1)',
          dirty: false
        }
      ],
      config: { target: 'typescript', options: {}, selection: { namespaces: ['test'], declarations: [] } }
    },
    new AbortController().signal
  );
  expect(artifact.manifest.files.map((file) => file.path)).not.toContain('index.ts');
});

it('exports the effective project graph and retains its exact applied receipt in the artifact', async () => {
  const { projectOverrideInput } = await import('../helpers/project-override-input.js');
  const { input: project, files } = await projectOverrideInput();
  const artifact = await generateExport(
    {
      workspaceId: 'p',
      sourceRevision: 1,
      files,
      project,
      config: {
        target: 'typescript',
        selection: { namespaces: ['ref'], declarations: [] },
        options: { typescript: { layout: 'per-namespace' } }
      }
    },
    new AbortController().signal
  );
  expect(artifact.manifest.projectReceipt).toEqual(project.receipt);
  expect(artifact.manifest.resolvedSelection?.included).toContainEqual({
    namespace: 'custom',
    name: 'Compute',
    kind: 'RosettaFunction'
  });
  expect(artifact.manifest.resolvedSelection?.included).not.toContainEqual({
    namespace: 'ref',
    name: 'Compute',
    kind: 'RosettaFunction'
  });
  const text = (await Promise.all(artifact.manifest.files.map((file) => artifact.readText(file.path)))).join('\n');
  expect(text).toMatch(/amount\s*\+\s*2/);
  expect(text).not.toMatch(/amount\s*\+\s*1/);
});

it('resolves named target namespace patterns against the effective graph and refuses a legacy artifact receipt', async () => {
  const { projectOverrideInput } = await import('../helpers/project-override-input.js');
  const { input: project, files } = await projectOverrideInput();
  const input = {
    workspaceId: 'p',
    sourceRevision: 1,
    files,
    project,
    projectBuild: true,
    projectTarget: {
      generator: 'typescript',
      output: 'generated/ts',
      namespaces: ['ref.*'],
      options: { layout: 'per-namespace' }
    },
    config: {
      target: 'typescript' as const,
      selection: { namespaces: [], declarations: [] },
      options: { typescript: { layout: 'per-namespace' } }
    }
  };
  const artifact = await generateExport(input, new AbortController().signal);
  expect(artifact.manifest.projectReceipt).toEqual(project.receipt);
  expect(artifact.manifest.resolvedSelection?.explicit).toContainEqual({
    namespace: 'ref',
    name: 'Caller',
    kind: 'RosettaFunction'
  });
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(new Uint8Array(await artifact.blob.arrayBuffer()));
  const manifest = { ...artifact.manifest };
  delete manifest.projectReceipt;
  zip.file('.rune/export.json', JSON.stringify(manifest));
  requestMock.mockResolvedValueOnce(new Response(await zip.generateAsync({ type: 'uint8array' })));
  await expect(generateExport(input, new AbortController().signal)).rejects.toThrow(/project receipt/i);
});
