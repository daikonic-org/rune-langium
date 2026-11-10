// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createProjectDraftSnapshot } from '../../packages/project-config/src/index.js';
import {
  resolveProjectReferences,
  createMemoryReferenceCache,
  loadLockedReferences
} from '../../packages/project-runtime/src/references/index.js';
import { prepareCuratedImplementationSources } from '../../packages/project-runtime/src/curated-implementations/install.js';
import type { CdmCodeListCatalog } from '../../packages/project-runtime/src/curated-implementations/code-list-resources.js';
import { curatedCdmCodeListSources } from '../../packages/project-runtime/src/curated-implementations/code-list-enums.js';
import { referenceModelSources } from '../../packages/codegen/test/helpers/cdm-reference.js';
import { createReferenceArtifacts, repository } from './project-reference-artifacts.js';

/** Shared fixture transport: publish, verify and install a pinned multi-model Rune implementation. */
export async function createCuratedRuneProject(
  directory: string,
  caller: { uri: string; content: string },
  codeLists?: CdmCodeListCatalog
) {
  const modelSources = referenceModelSources(directory);
  const manifest: { sources: { model: string; release: string; commit: string }[] } = JSON.parse(
    readFileSync(resolve(directory, 'sources.json'), 'utf8')
  );
  if (codeLists) {
    const cdm = manifest.sources.find((source) => source.model === 'cdm');
    if (!cdm) throw new Error('Missing pinned CDM code-list source.');
    modelSources.cdm = [...(modelSources.cdm ?? []), ...curatedCdmCodeListSources(codeLists, cdm.commit)];
  }
  const version = (model: string) => {
    const found = manifest.sources.find((source) => source.model === model)?.release;
    if (!found) throw new Error('Missing pinned fixture release: ' + model);
    return found;
  };
  const definitions: NonNullable<Parameters<typeof createReferenceArtifacts>[1]> = Object.keys(modelSources).map(
    (model) => [
      model,
      version(model),
      Object.fromEntries(
        (model === 'cdm'
          ? ['rune-dsl', ...(modelSources.fpml ? ['fpml'] : [])]
          : model === 'fpml'
            ? ['rune-dsl']
            : []
        ).map((dependency) => [dependency, { modelId: dependency, release: version(dependency) }])
      )
    ]
  );
  const fixture = await createReferenceArtifacts(
    { cdm: { repository: repository('cdm'), release: version('cdm') } },
    definitions,
    modelSources,
    'https://www.daikonic.dev/curated',
    true,
    codeLists
  );
  const cache = createMemoryReferenceCache();
  const signal = new AbortController().signal;
  const resolved = await resolveProjectReferences(fixture.snapshot, fixture.transport, signal, cache);
  if (!resolved.lock || resolved.diagnostics.length)
    throw new Error('Implementation fixture resolution failed: ' + JSON.stringify(resolved.diagnostics));
  const loaded = await loadLockedReferences(resolved.lock, fixture.transport, cache, signal);
  if (loaded.diagnostics.length) throw new Error(JSON.stringify(loaded.diagnostics));
  const snapshot = await createProjectDraftSnapshot(
    fixture.snapshot,
    new Map([
      ['build-config.lock.json', JSON.stringify(resolved.lock)],
      [new URL(caller.uri).pathname.slice(1), caller.content]
    ]),
    () => []
  );
  const prepared = await prepareCuratedImplementationSources(snapshot, loaded.documents);
  if (prepared.diagnostics.length) throw new Error(JSON.stringify(prepared.diagnostics));
  const installed = await createProjectDraftSnapshot(snapshot, prepared.changes, () => []);
  return { fixture, references: loaded.documents, snapshot, installed, changes: prepared.changes };
}

/** Read the exact upstream resource bytes used when publishing a fixture bundle. */
export function curatedFixtureResources(directory: string) {
  const manifest: { references: { name: string; sha256: string; upstream: { path: string } }[] } = JSON.parse(
    readFileSync(resolve(directory, 'sources.json'), 'utf8')
  );
  return new Map(
    manifest.references
      .filter(({ name }) => name.startsWith('resources/'))
      .map(({ name, upstream, sha256 }) => {
        const content = readFileSync(resolve(directory, name), 'utf8');
        if (createHash('sha256').update(content).digest('hex') !== sha256)
          throw new Error('Pinned resource changed: ' + name);
        return [name, { path: upstream.path, content }];
      })
  );
}
