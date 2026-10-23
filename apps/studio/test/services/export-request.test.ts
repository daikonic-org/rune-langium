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
    return handleCodegenDownload({
      request: new Request('https://example.com/api/codegen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
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
