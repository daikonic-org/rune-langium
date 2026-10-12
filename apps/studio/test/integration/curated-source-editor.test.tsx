// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { createRuneDslServices, serializeRuneModel } from '@rune-langium/core';
import { URI } from 'langium';
import { gzip } from 'pako';
import type { EditorView } from '@codemirror/view';
import { onRequestPost as parsePost } from '../../functions/api/parse.js';
import { onRequestPost as sourcePost } from '../../functions/api/curated-source.js';
import {
  parseWorkspaceViaRouter,
  mergeModelFiles,
  loadCuratedNamespaceSource,
  resetCuratedDocumentCache
} from '../../src/services/workspace.js';
import { useModelStore } from '../../src/store/model-store.js';
import { SourceEditor, type SourceEditorRef } from '../../src/components/SourceEditor.js';
import { resolveHydratedSourcePath } from '../../src/shell/explore-file-nav-store.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetCuratedDocumentCache();
  useModelStore.setState({ models: new Map() });
});

it('loads original curated source on demand and displays it in a read-only editor', async () => {
  const content =
    '// Preserve this comment\nnamespace curated.source\n\ntype Example:\n  value string (1..1)\n' +
    '\n'.repeat(80) +
    'func Identity:\n  inputs:\n    value int (1..1)\n  output:\n    result int (1..1)\n  set result:\n    value\n';
  const { RuneDsl } = createRuneDslServices();
  const document = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
    content,
    URI.parse('file:///[cdm]/example.rosetta')
  );
  await RuneDsl.shared.workspace.DocumentBuilder.build([document]);
  const modelJson = serializeRuneModel(RuneDsl.serializer.JsonSerializer, document.parseResult.value);
  const enumContent = 'namespace curated.source\nenum Role:\n  Manager\n';
  const enumDocument = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
    enumContent,
    URI.parse('file:///[cdm]/enums.rosetta')
  );
  await RuneDsl.shared.workspace.DocumentBuilder.build([enumDocument]);
  const enumJson = serializeRuneModel(RuneDsl.serializer.JsonSerializer, enumDocument.parseResult.value);
  const artifactPath = 'https://www.daikonic.dev/curated/cdm/artifacts/source-test/ns/curated.source.json.gz';
  const mirrorRequests: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/parse') {
        return parsePost({ request: new Request('https://studio.test/api/parse', init) } as never);
      }
      if (input === '/api/curated-source') {
        return sourcePost({ request: new Request('https://studio.test/api/curated-source', init) } as never);
      }
      mirrorRequests.push(input);
      if (input.endsWith('/manifest.json')) {
        return Response.json({
          schemaVersion: 2,
          modelId: 'cdm',
          version: '2026-09-13',
          sha256: 'a'.repeat(64),
          sizeBytes: 1,
          generatedAt: 'now',
          upstreamCommit: '',
          upstreamRef: 'master',
          archiveUrl: 'https://www.daikonic.dev/curated/cdm/latest.tar.gz',
          history: [],
          namespaces: {
            'curated.source': {
              deps: [],
              exports: [
                { type: 'Data', name: 'Example' },
                { type: 'RosettaFunction', name: 'Identity' },
                { type: 'RosettaEnumeration', name: 'Role' }
              ],
              artifact: artifactPath
            }
          }
        });
      }
      if (input === artifactPath) {
        return new Response(
          gzip(
            JSON.stringify({
              documents: [
                {
                  path: 'enums.rosetta',
                  content: enumContent,
                  modelJson: enumJson,
                  exports: [{ type: 'RosettaEnumeration', name: 'Role', path: '/elements@0' }]
                },
                {
                  path: 'example.rosetta',
                  content,
                  modelJson,
                  exports: [
                    { type: 'Data', name: 'Example', path: '/elements@0' },
                    { type: 'RosettaFunction', name: 'Identity', path: '/elements@1' }
                  ]
                }
              ]
            })
          )
        );
      }
      throw new Error(`Unexpected fetch: ${input}`);
    })
  );

  const curatedBundles = [{ id: 'cdm', version: 'latest' }];
  const catalog = await parseWorkspaceViaRouter([], { curatedBundles });
  expect(catalog.curatedRefOnlyFiles?.cdm?.[0]?.content).toBe('');
  expect(mirrorRequests).toEqual(['https://www.daikonic.dev/curated/cdm/manifest.json']);

  const result = await parseWorkspaceViaRouter([], { curatedBundles, hydrateNamespaces: ['curated.source'] });
  expect(result.curatedRefOnlyFiles?.cdm?.[0]).toMatchObject({ content: '', sourceLoaded: false });
  const artifactKey = result.curatedRefOnlyFiles!.cdm![0]!.artifactKey;
  expect(await loadCuratedNamespaceSource('cdm', 'latest', 'curated.source', artifactKey)).toMatchObject({
    documents: [
      { uri: 'cdm/enums.rosetta', content: enumContent },
      { uri: 'cdm/example.rosetta', content }
    ]
  });
  const files = (await parseWorkspaceViaRouter([], { curatedBundles, hydrateNamespaces: ['curated.source'] }))
    .curatedRefOnlyFiles!.cdm!;
  expect(files[1]).toMatchObject({ content, sourceLoaded: true, refOnly: true, serializedModelJson: modelJson });
  expect(mirrorRequests.filter((url) => !url.endsWith('/manifest.json'))).toEqual([artifactPath]);
  const model = {
    source: { id: 'cdm', name: 'CDM', repoUrl: 'https://example.com/cdm.git', ref: 'master', paths: [] },
    commitHash: 'latest',
    loadedAt: 0,
    files: files.map((file) => ({ ...file, content: '' }))
  };
  useModelStore.setState({ models: new Map([['cdm', model]]) });
  let view: EditorView | undefined;
  const ref = React.createRef<SourceEditorRef>();
  const initial = mergeModelFiles([], model);
  const owner = result.deferredExports?.find((entry) =>
    entry.exports.some((declaration) => declaration.name === 'Example')
  );
  expect(owner?.filePath).toBe('cdm/example.rosetta');
  const activeFile = resolveHydratedSourcePath(
    {
      bundleId: 'cdm',
      bundleVersion: 'latest',
      namespace: 'curated.source',
      path: '[cdm]/curated.source',
      nodeId: 'curated.source.Example'
    },
    initial,
    ['curated.source'],
    owner?.filePath
  );
  expect(activeFile).toBe('[cdm]/example.rosetta');
  const editor = render(
    <SourceEditor
      ref={ref}
      files={initial}
      activeFile={activeFile}
      onEditorViewCreated={(_path, created) => {
        view = created;
      }}
    />
  );
  expect(view!.state.doc.toString()).toBe('');

  useModelStore.getState().setCuratedFiles('cdm', files);
  const loaded = useModelStore.getState().models.get('cdm')!;
  expect(loaded.files[1]!.content).toBe(content);
  editor.rerender(<SourceEditor ref={ref} files={mergeModelFiles([], loaded)} activeFile={activeFile} />);
  expect(view!.state.doc.toString()).toBe(content);
  expect(view!.state.readOnly).toBe(true);
  expect(editor.container.querySelector('.cm-content')?.textContent).toContain('Preserve this comment');
  const functionLine = content.slice(0, content.indexOf('func Identity:')).split('\n').length;
  expect(ref.current!.revealLine(functionLine, '[cdm]/enums.rosetta')).toBe(false);
  expect(ref.current!.revealLine(functionLine, activeFile)).toBe(true);
  expect(view!.state.selection.main.head).toBe(view!.state.doc.line(functionLine).from);
  expect(view!.state.doc.toString()).toBe(content);
});
