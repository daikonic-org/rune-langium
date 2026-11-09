// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { createProjectSnapshot } from '../../packages/project-config/src/index.js';
import type { ReferenceRelease } from '../../packages/curated-schema/src/index.js';
import type { RosettaModel } from '../../packages/core/src/index.js';
import type { CdmCodeListCatalog } from '../../packages/project-runtime/src/curated-implementations/code-list-resources.js';
import { PROJECT_TOOLCHAIN } from '../../packages/project-runtime/src/project-build.js';
const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export const repository = (id: string) => `https://github.com/org/${id}`;
const cohort = (id: string, tag: string) => 'cohort-' + hash(id + tag);
type ReleaseDefinition = readonly [string, string, ReferenceRelease['dependencies']];
type ModelSource = string | readonly { path: string; content: string }[];
const defaultReleases: readonly ReleaseDefinition[] = [
  ['rune-dsl', '1.0', {}],
  ['rune-dsl', '2.0', {}],
  ['cdm', '1.0', { 'rune-dsl': { modelId: 'rune-dsl', release: '1.0' } }],
  ['cdm', '2.0', { 'rune-dsl': { modelId: 'rune-dsl', release: '2.0' } }]
];
export async function createReferenceArtifacts(
  refs: Record<string, { repository: string; release: string }> = {
    cdm: { repository: repository('cdm'), release: '1.0' }
  },
  definitions: readonly ReleaseDefinition[] = defaultReleases,
  modelSources: Readonly<Record<string, ModelSource>> = {},
  baseUrl = 'https://mirror.example',
  publishImplementations = false,
  codeLists?: CdmCodeListCatalog
) {
  const mirrorOrigin = new URL(baseUrl).origin;
  const artifacts = new Map<string, Uint8Array>();
  const releases = new Map<string, ReferenceRelease[]>();
  const sourcesByModel = new Map(
    Object.entries(modelSources).map(([id, source]) => [
      id,
      typeof source === 'string' ? [{ path: 'model.rosetta', content: source }] : source
    ])
  );
  const serializedModels = new Map<string, string>();
  const parsedModels = new Map<string, RosettaModel>();
  if (Object.keys(modelSources).length) {
    const { serializeRuneModel } = await import('../../packages/core/src/index.js');
    const { buildEffectiveProject } = await import('../../packages/project-runtime/src/effective-project.js');
    const { projectReferenceUri } = await import('../../packages/project-runtime/src/project-uri.js');
    const compilerSnapshot = await createProjectSnapshot(
      'fixture',
      new Map([
        ['rune-config.yml', 'model: {name: Fixture}'],
        ['build-config.yml', 'schemaVersion: 1']
      ]),
      () => []
    );
    const graph = await buildEffectiveProject(
      compilerSnapshot,
      [...sourcesByModel].flatMap(([id, files]) =>
        files.map((file) => ({ uri: `${id}/${file.path}`, content: file.content }))
      )
    );
    if (graph.diagnostics.length) throw new Error(graph.diagnostics.map((issue) => issue.message).join('\n'));
    for (const [id, files] of sourcesByModel)
      for (const file of files) {
        const key = `${id}/${file.path}`;
        const document = graph.documents.find((document) => document.uri.toString(true) === projectReferenceUri(key));
        if (!document) throw new Error('Missing linked fixture model: ' + id);
        const { isRosettaModel } = await import('../../packages/core/src/index.js');
        if (!isRosettaModel(document.parseResult.value)) throw new Error('Expected fixture model.');
        parsedModels.set(key, document.parseResult.value);
        serializedModels.set(
          key,
          serializeRuneModel(graph.services.serializer.JsonSerializer, document.parseResult.value)
        );
      }
  }
  for (const [id, tag, dependencies] of definitions) {
    const commit = createHash('sha1')
      .update(id + tag)
      .digest('hex');
    const sourceFiles = sourcesByModel.get(id) ?? [
      { path: 'model.rosetta', content: `namespace ${id.replace('-', '_')}\ntype Example:\n name string (1..1)` }
    ];
    const documents = [];
    for (const { path, content } of sourceFiles) {
      const key = `${id}/${path}`;
      let modelJson = serializedModels.get(key) ?? JSON.stringify({ $type: 'RosettaModel', name: id, elements: [] });
      if (publishImplementations && parsedModels.has(key)) {
        const { publishCuratedImplementations } =
          await import('../../packages/project-runtime/src/curated-implementations/publication.js');
        modelJson = await publishCuratedImplementations(
          parsedModels.get(key)!,
          modelJson,
          { model: id, commit },
          codeLists
        );
      }
      documents.push({ path, content, modelJson });
    }
    const bytes = gzipSync(
      JSON.stringify({
        schemaVersion: 1,
        kind: 'langium-json-serializer',
        modelId: id,
        version: '2026-10-23',
        langiumVersion: '4.4.0',
        documents
      })
    );
    const artifactUrl = `${mirrorOrigin}/curated/${id}/artifacts/2026-10-23-${hash(bytes).slice(0, 12)}.serialized.json.gz`;
    artifacts.set(artifactUrl, bytes);
    const manifest = `${mirrorOrigin}/curated/${id}/artifacts/${cohort(id, tag)}/manifest.json`;
    const text = JSON.stringify({
      schemaVersion: 2,
      modelId: id,
      version: '2026-10-23',
      sha256: 'a'.repeat(64),
      sizeBytes: 1,
      generatedAt: '2026-10-23T00:00:00Z',
      upstreamCommit: commit,
      upstreamRef: tag,
      archiveUrl: `${mirrorOrigin}/curated/${id}/latest.tar.gz`,
      history: [],
      cohort: cohort(id, tag),
      dependencies: Object.fromEntries(
        Object.entries(dependencies).map(([key, dep]) => [key, cohort(key, dep.release)])
      ),
      artifacts: {
        serializedWorkspace: {
          schemaVersion: 1,
          kind: 'langium-json-serializer',
          url: artifactUrl,
          sha256: hash(bytes),
          sizeBytes: bytes.byteLength,
          documentCount: documents.length,
          langiumVersion: '4.4.0'
        }
      }
    });
    artifacts.set(manifest, new TextEncoder().encode(text));
    const release: ReferenceRelease = {
      modelId: id,
      repository: repository(id),
      tag,
      commit,
      manifest,
      cohort: cohort(id, tag),
      checksum: hash(text),
      dependencies: structuredClone(dependencies),
      toolchain: JSON.stringify({ ...PROJECT_TOOLCHAIN, langium: '4.4.0' })
    };
    releases.set(id, [...(releases.get(id) ?? []), release]);
  }
  const snapshot = await createProjectSnapshot(
    'p',
    new Map([
      ['rune-config.yml', 'model: {name: Demo}'],
      ['build-config.yml', JSON.stringify({ schemaVersion: 1, references: refs })]
    ]),
    () => []
  );
  const transport = {
    catalog: async (id: string, _signal: AbortSignal) => ({
      schemaVersion: 1 as const,
      releases: releases.get(id) ?? []
    }),
    artifact: async (url: string, _signal: AbortSignal) => {
      const bytes = artifacts.get(url);
      if (!bytes) throw new Error('Missing manifest/artifact');
      return bytes.slice();
    }
  };
  return { snapshot, transport, artifacts, releases };
}
