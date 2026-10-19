// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, expect, it, vi } from 'vitest';
import type { CuratedManifest } from '@rune-langium/curated-schema';
import * as curated from '../../src/services/curated-fetch.js';
import { loadCuratedWorkspace } from '../../src/services/curated-workspace.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const oldCohort = `cohort-${'a'.repeat(64)}`;
const newCohort = `cohort-${'b'.repeat(64)}`;

function manifest(id: 'cdm' | 'fpml', cohort: string): CuratedManifest {
  return {
    schemaVersion: 2,
    modelId: id,
    cohort,
    version: '2026-09-12',
    sha256: 'a'.repeat(64),
    sizeBytes: 1,
    generatedAt: 'now',
    upstreamCommit: '',
    upstreamRef: 'master',
    archiveUrl: `https://example.com/${id}`,
    history: [],
    dependencies: { [id === 'cdm' ? 'fpml' : 'cdm']: cohort },
    namespaces: {
      [id]: { deps: id === 'cdm' ? ['fpml'] : [], exports: [], artifact: `${cohort}/${id}.json.gz` },
      [`${id}.unused`]: { deps: [], exports: [], artifact: `${cohort}/${id}.unused.json.gz` }
    }
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it('fills free artifact slots before stragglers finish while preserving output order', async () => {
  vi.useFakeTimers();
  const names = Array.from({ length: 16 }, (_, i) => `cdm.n${i.toString().padStart(2, '0')}`);
  const cdm = manifest('cdm', oldCohort);
  cdm.dependencies = {};
  cdm.namespaces = Object.fromEntries(names.map((name) => [name, { deps: [], exports: [], artifact: name }]));
  vi.spyOn(curated, 'fetchCuratedManifest').mockResolvedValue(cdm);
  let active = 0;
  let peak = 0;
  const namespaces = vi.spyOn(curated, 'fetchCuratedNamespace').mockImplementation(async (_id, _version, artifact) => {
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setTimeout(resolve, artifact === names[0] || artifact === names[8] ? 1000 : 10));
    active--;
    return [{ uri: `${artifact}.rosetta`, content: '', serializedModel: '{}', exports: [] }];
  });
  const started = Date.now();
  const loading = loadCuratedWorkspace([{ id: 'cdm', version: oldCohort }], new Set(names));
  await vi.advanceTimersByTimeAsync(20);
  // The second slow download must start in a freed slot, not wait for the first.
  const secondStragglerStarted = namespaces.mock.calls.some(([, , artifact]) => artifact === names[8]);
  await vi.runAllTimersAsync();
  const loaded = await loading;
  expect(secondStragglerStarted).toBe(true);
  expect(Date.now() - started).toBe(1010);
  expect(peak).toBe(8);
  expect(loaded.bundles[0]!.documents.map(({ uri }) => uri)).toEqual(names.map((name) => `${name}.rosetta`));
  expect(loaded.artifacts.map(({ namespace, documentCount }) => [namespace, documentCount])).toEqual(
    names.map((name) => [name, 1])
  );
});

it('stops claiming queued artifacts after a download fails', async () => {
  const names = Array.from({ length: 16 }, (_, i) => `cdm.failure${i}`);
  const cdm = manifest('cdm', oldCohort);
  cdm.dependencies = {};
  cdm.namespaces = Object.fromEntries(names.map((name) => [name, { deps: [], exports: [], artifact: name }]));
  vi.spyOn(curated, 'fetchCuratedManifest').mockResolvedValue(cdm);
  const pending = deferred<[]>();
  const namespaces = vi.spyOn(curated, 'fetchCuratedNamespace').mockImplementation(async (_id, _version, artifact) => {
    if (artifact === names[0]) throw new Error('artifact unavailable');
    return pending.promise;
  });
  await expect(loadCuratedWorkspace([{ id: 'cdm', version: oldCohort }], new Set(names))).rejects.toThrow(
    'artifact unavailable'
  );
  pending.resolve([]);
  await Promise.resolve();
  await Promise.resolve();
  expect(namespaces).toHaveBeenCalledTimes(8);
});

it('starts independent pinned manifests and namespace artifacts in the same wave', async () => {
  const cohort = oldCohort;
  const cdm = manifest('cdm', cohort);
  cdm.dependencies = { fpml: cohort, 'rune-dsl': cohort };
  cdm.namespaces!.cdm!.deps = ['fpml', 'rune-dsl'];
  const fpml = manifest('fpml', cohort);
  const rune = {
    ...manifest('fpml', cohort),
    modelId: 'rune-dsl',
    dependencies: {},
    namespaces: { 'rune-dsl': { deps: [], exports: [], artifact: `${cohort}/rune-dsl.json.gz` } }
  } satisfies CuratedManifest;
  const fpmlManifest = deferred<CuratedManifest>();
  const runeManifest = deferred<CuratedManifest>();
  const cdmNamespace = deferred<[]>();
  const manifests = vi.spyOn(curated, 'fetchCuratedManifest').mockImplementation(async (id) => {
    if (id === 'cdm') return cdm;
    return id === 'fpml' ? fpmlManifest.promise : runeManifest.promise;
  });
  const namespaces = vi
    .spyOn(curated, 'fetchCuratedNamespace')
    .mockImplementation(async (id) => (id === 'cdm' ? cdmNamespace.promise : []));

  const loading = loadCuratedWorkspace([{ id: 'cdm', version: cohort }], new Set(['cdm']));
  await vi.waitFor(() => expect(manifests.mock.calls.map(([id]) => id)).toEqual(['cdm', 'fpml', 'rune-dsl']));
  fpmlManifest.resolve(fpml);
  runeManifest.resolve(rune);
  await vi.waitFor(() => expect(namespaces.mock.calls.map(([id]) => id)).toEqual(['cdm', 'fpml', 'rune-dsl']));
  cdmNamespace.resolve([]);
  const loaded = await loading;
  expect(loaded.bundles.map(({ id }) => id)).toEqual(['cdm', 'fpml', 'rune-dsl']);
});

it.each([
  ['cdm', 'fpml'],
  ['fpml', 'cdm']
] as const)('pins floating roots %s and %s to one cohort despite partial latest publication', async (first, second) => {
  const manifests = vi
    .spyOn(curated, 'fetchCuratedManifest')
    .mockImplementation(async (id, version) =>
      manifest(id as 'cdm' | 'fpml', version === 'latest' ? (id === 'cdm' ? newCohort : oldCohort) : version)
    );
  const namespaces = vi.spyOn(curated, 'fetchCuratedNamespace').mockResolvedValue([]);
  const loaded = await loadCuratedWorkspace(
    [
      { id: first, version: 'latest' },
      { id: second, version: 'latest' }
    ],
    new Set(['cdm'])
  );
  const cohort = first === 'cdm' ? newCohort : oldCohort;
  expect([...loaded.closure].sort()).toEqual(['cdm', 'fpml']);
  expect(loaded.bundles.every((bundle) => bundle.manifest.cohort === cohort)).toBe(true);
  expect(manifests.mock.calls.map(([id, version]) => [id, version])).toEqual([
    [first, 'latest'],
    [first, cohort],
    [second, cohort]
  ]);
  expect(namespaces.mock.calls.map(([id, version, artifact]) => [id, version, artifact])).toEqual([
    [first, cohort, `${cohort}/${first}.json.gz`],
    [second, cohort, `${cohort}/${second}.json.gz`]
  ]);
});

it('rejects incompatible pinned roots before fetching namespace documents', async () => {
  vi.spyOn(curated, 'fetchCuratedManifest').mockResolvedValue(manifest('cdm', newCohort));
  const namespaces = vi.spyOn(curated, 'fetchCuratedNamespace');
  await expect(
    loadCuratedWorkspace(
      [
        { id: 'cdm', version: newCohort },
        { id: 'fpml', version: oldCohort }
      ],
      new Set(['cdm'])
    )
  ).rejects.toThrow(curated.CuratedBundleUnavailableError);
  expect(namespaces).not.toHaveBeenCalled();
});

it('skips only artifacts the browser holds for the exact cohort', async () => {
  vi.spyOn(curated, 'fetchCuratedManifest').mockImplementation(async (id) => manifest(id as 'cdm' | 'fpml', newCohort));
  const namespaces = vi.spyOn(curated, 'fetchCuratedNamespace').mockResolvedValue([]);
  const oldKey = JSON.stringify(['cdm', `${oldCohort}/cdm.json.gz`]);
  const currentKey = JSON.stringify(['cdm', `${newCohort}/cdm.json.gz`]);
  const roots = [{ id: 'cdm', version: newCohort }];

  const cold = await loadCuratedWorkspace(roots, new Set(['cdm']), undefined, false, new Set([oldKey]));
  expect(namespaces.mock.calls.map(([id]) => id)).toEqual(['cdm', 'fpml']);
  expect(cold.artifacts.map(({ key }) => key)).toContain(currentKey);

  namespaces.mockClear();
  const warm = await loadCuratedWorkspace(roots, new Set(['cdm']), undefined, false, new Set([currentKey]));
  expect(namespaces.mock.calls.map(([id]) => id)).toEqual(['fpml']);
  expect(warm.artifacts).toHaveLength(2);
});
