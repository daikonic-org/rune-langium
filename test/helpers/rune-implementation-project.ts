// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { readFile } from 'node:fs/promises';
import { createProjectSnapshot } from '../../packages/project-config/src/index.js';
import {
  resolveProjectReferences,
  loadLockedReferences,
  createMemoryReferenceCache
} from '../../packages/project-runtime/src/references/index.js';
import { createReferenceArtifacts, repository } from './project-reference-artifacts.js';
/** Owned source fixture; the public model ID is transport plumbing, not a CDM business implementation. */
export async function runeImplementationProject(baseUrl = 'https://mirror.example') {
  const root = new URL('../../packages/project-runtime/test/fixtures/implementations/', import.meta.url);
  const read = (name: string) => readFile(new URL(name, root), 'utf8');
  const [reference, local, build, studio] = await Promise.all(
    ['reference.rosetta', 'local.rosetta', 'build-config.yml', 'studio-config.yml'].map(read)
  );
  const fixture = await createReferenceArtifacts(
    { cdm: { repository: repository('cdm'), release: 'fixture-1' } },
    [['cdm', 'fixture-1', {}]],
    { cdm: reference! },
    baseUrl
  );
  const files = new Map<string, string>([
    ['rune-config.yml', 'model: {name: Rune implementation example}\n'],
    ['build-config.yml', build!],
    ['studio-config.yml', studio!],
    ['model/local.rosetta', local!],
    [
      'examples/input.example.json',
      JSON.stringify({
        schemaVersion: 1,
        id: 'quote-input',
        name: 'Input quote',
        type: { model: 'local', namespace: 'example.local', kind: 'Data', name: 'Quote' },
        payload: 'examples/input.json',
        codec: 'json',
        expected: 'fixtures/expected/output.json'
      })
    ],
    ['examples/input.json', '{"amount":10,"currency":"USD"}\n'],
    ['fixtures/expected/output.json', '{"amount":20,"currency":"USD"}\n']
  ]);
  let snapshot = await createProjectSnapshot('rune-first', files, () => []);
  const cache = createMemoryReferenceCache();
  const resolved = await resolveProjectReferences(snapshot, fixture.transport, new AbortController().signal, cache);
  if (!resolved.lock) throw new Error(resolved.diagnostics.map((issue) => issue.message).join('\n'));
  files.set('build-config.lock.json', JSON.stringify(resolved.lock));
  snapshot = await createProjectSnapshot('rune-first', files, () => []);
  const loaded = await loadLockedReferences(resolved.lock, fixture.transport, cache, new AbortController().signal);
  if (loaded.diagnostics.length) throw new Error(loaded.diagnostics.map((issue) => issue.message).join('\n'));
  return { ...fixture, files, snapshot, cache, documents: loaded.documents, reference: reference!, local: local! };
}
