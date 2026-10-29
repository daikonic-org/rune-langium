// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { it, expect, vi } from 'vitest';
import { referenceFixture, repository } from '../../../test/helpers/project-reference-fixture.js';
import {
  resolveProjectReferences,
  resolveProjectReferenceInventory,
  projectReferenceLockDiagnostics
} from '../src/references/resolve.js';
import { loadLockedReferences } from '../src/references/load.js';
import { createMemoryReferenceCache } from '../src/references/cache.js';
const signal = () => new AbortController().signal;

it('resolves informational inventory without exposing an activation lock, fetching bundles or promoting bytes', async () => {
  const { snapshot, transport, artifacts } = await referenceFixture();
  const cache = createMemoryReferenceCache();
  const put = vi.spyOn(cache, 'put');
  for (const [url] of artifacts) if (url.endsWith('.serialized.json.gz')) artifacts.set(url, new Uint8Array([1, 2, 3]));
  const inventory = await resolveProjectReferenceInventory(
    snapshot.project.build.references,
    transport,
    signal(),
    cache
  );
  expect(inventory.diagnostics).toEqual([]);
  expect([...inventory.manifests.keys()]).toEqual(['cdm', 'rune-dsl']);
  expect(inventory).not.toHaveProperty('lock');
  expect(transport.artifact.mock.calls.every(([url]) => url.endsWith('/manifest.json'))).toBe(true);
  expect(put).not.toHaveBeenCalled();
  expect((await resolveProjectReferences(snapshot, transport, signal(), cache)).lock).toBeUndefined();
  expect(put).not.toHaveBeenCalled();
});
it('resolves one exact release per model and loads locked content without catalog/latest lookup', async () => {
  const { snapshot, transport } = await referenceFixture();
  const cache = createMemoryReferenceCache();
  const resolved = await resolveProjectReferences(snapshot, transport, signal(), cache);
  expect(resolved.diagnostics).toEqual([]);
  expect(Object.keys(resolved.lock!.references)).toEqual(['cdm', 'rune-dsl']);
  transport.catalog.mockImplementation(async () => {
    throw new Error('Catalog must not be consulted');
  });
  transport.artifact.mockImplementation(async () => {
    throw new Error('Offline');
  });
  const loaded = await loadLockedReferences(resolved.lock!, transport, cache, signal());
  expect(loaded.diagnostics).toEqual([]);
  expect(loaded.documents).toHaveLength(2);
  expect(transport.catalog).toHaveBeenCalledTimes(2);
  expect(
    loaded.documents.every((doc) => doc.content.includes('namespace') && doc.serialized?.includes('RosettaModel'))
  ).toBe(true);
});
it('reports an offline cache miss without fetching latest or returning partial documents', async () => {
  const { snapshot, transport } = await referenceFixture();
  const lock = (await resolveProjectReferences(snapshot, transport, signal())).lock!;
  transport.artifact.mockImplementation(async () => {
    throw new Error('Offline');
  });
  const loaded = await loadLockedReferences(lock, transport, createMemoryReferenceCache(), signal());
  expect(loaded.documents).toEqual([]);
  expect(loaded.diagnostics.some((issue) => issue.severity === 'error')).toBe(true);
  expect(transport.artifact.mock.calls.every(([url]) => !url.includes('/latest'))).toBe(true);
});
it('does not cache or expose an incomplete closure after a checksum mismatch', async () => {
  const { snapshot, transport, artifacts, releases } = await referenceFixture();
  const lock = (await resolveProjectReferences(snapshot, transport, signal())).lock!;
  artifacts.set(releases.get('rune-dsl')![0]!.manifest, new Uint8Array([1, 2, 3]));
  const cache = createMemoryReferenceCache();
  const put = vi.spyOn(cache, 'put');
  const loaded = await loadLockedReferences(lock, transport, cache, signal());
  expect(loaded.documents).toEqual([]);
  expect(loaded.diagnostics.some((issue) => issue.code === 'REFERENCE_CHECKSUM')).toBe(true);
  expect(put).not.toHaveBeenCalled();
});
it('reports conflicting direct/transitive versions with dependency paths', async () => {
  const { snapshot, transport } = await referenceFixture({
    cdm: { repository: repository('cdm'), release: '1.0' },
    'rune-dsl': { repository: repository('rune-dsl'), release: '2.0' }
  });
  const result = await resolveProjectReferences(snapshot, transport, signal());
  expect(result.lock).toBeUndefined();
  expect(result.diagnostics[0]?.message).toMatch(/cdm.*rune-dsl|rune-dsl.*cdm/);
});
it('rejects a moved existing tag and preserves the old lock', async () => {
  const { snapshot, transport, releases } = await referenceFixture();
  const lock = (await resolveProjectReferences(snapshot, transport, signal())).lock!;
  const before = structuredClone(lock);
  releases.get('cdm')![0]!.commit = 'f'.repeat(40);
  const result = await resolveProjectReferences({ ...snapshot, lock }, transport, signal());
  expect(result.lock).toBeUndefined();
  expect(result.diagnostics.some((issue) => issue.code === 'REFERENCE_MOVED_TAG')).toBe(true);
  expect(lock).toEqual(before);
});
it('does not propose a lock when a manifest is missing or a release is unavailable', async () => {
  const { snapshot, transport, releases, artifacts } = await referenceFixture();
  artifacts.delete(releases.get('rune-dsl')![0]!.manifest);
  expect((await resolveProjectReferences(snapshot, transport, signal())).lock).toBeUndefined();
  const unknown = await referenceFixture({ cdm: { repository: repository('cdm'), release: 'missing' } });
  expect((await resolveProjectReferences(unknown.snapshot, unknown.transport, signal())).lock).toBeUndefined();
  expect(unknown.transport.artifact).not.toHaveBeenCalled();
});
it('keeps different workspace pins isolated and aborts an upgrade before publication', async () => {
  const first = await referenceFixture();
  const second = await referenceFixture({ cdm: { repository: repository('cdm'), release: '2.0' } });
  const a = await resolveProjectReferences(first.snapshot, first.transport, signal());
  const b = await resolveProjectReferences({ ...second.snapshot, workspaceId: 'second' }, second.transport, signal());
  expect(a.lock!.references.cdm!.commit).not.toBe(b.lock!.references.cdm!.commit);
  let release!: (catalog: Awaited<ReturnType<typeof first.transport.catalog>>) => void;
  first.transport.catalog.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  const abort = new AbortController();
  const pending = resolveProjectReferences({ ...first.snapshot, lock: a.lock }, first.transport, abort.signal);
  while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
  abort.abort();
  release({ schemaVersion: 1, releases: first.releases.get('cdm')! });
  expect((await pending).lock).toBeUndefined();
  expect(a.lock!.references.cdm!.release).toBe('1.0');
});

it('rejects unavailable toolchains before fetching their artifacts', async () => {
  const { snapshot, transport, releases } = await referenceFixture();
  releases.get('cdm')![0]!.toolchain = JSON.stringify({
    '@rune-langium/core': '0.0.0',
    '@rune-langium/codegen': '0.1.0',
    langium: '4.4.0'
  });
  const unavailable = await resolveProjectReferences(snapshot, transport, signal());
  expect(unavailable.lock).toBeUndefined();
  expect(unavailable.diagnostics[0]?.code).toBe('REFERENCE_TOOLCHAIN');
  expect(transport.artifact).not.toHaveBeenCalled();
});
it('rejects corrupt cache bytes and recovers from the pinned artifact without a latest lookup', async () => {
  const { snapshot, transport } = await referenceFixture();
  const lock = (await resolveProjectReferences(snapshot, transport, signal())).lock!;
  const put = vi.fn(async () => undefined);
  const cache = { get: async () => new Uint8Array([9, 9]), put };
  const loaded = await loadLockedReferences(lock, transport, cache, signal());
  expect(loaded.diagnostics).toEqual([]);
  expect(loaded.documents).toHaveLength(2);
  expect(put).toHaveBeenCalled();
});

it('keeps an older parent release resolvable when its dependency tag has a newer compiled cohort', async () => {
  const { snapshot, transport, releases, artifacts } = await referenceFixture();
  const original = releases.get('rune-dsl')![0]!;
  const variant = {
    ...original,
    cohort: 'cohort-' + 'f'.repeat(64),
    manifest: 'https://mirror.example/curated/rune-dsl/artifacts/cohort-' + 'f'.repeat(64) + '/manifest.json'
  };
  const manifest = {
    ...JSON.parse(new TextDecoder().decode(artifacts.get(original.manifest))),
    cohort: variant.cohort
  };
  const bytes = new TextEncoder().encode(JSON.stringify(manifest));
  const { projectBytesRevision } = await import('@rune-langium/project-config');
  variant.checksum = await projectBytesRevision(bytes);
  releases.get('rune-dsl')!.push(variant);
  artifacts.set(variant.manifest, bytes);
  const resolved = await resolveProjectReferences(snapshot, transport, signal());
  expect(resolved.diagnostics).toEqual([]);
  expect(resolved.lock!.references['rune-dsl']!.cohort).toBe(original.cohort);
  transport.artifact.mockClear();
  const inventory = await resolveProjectReferenceInventory(snapshot.project.build.references, transport, signal());
  expect(inventory.diagnostics).toEqual([]);
  expect(inventory.manifests.get('rune-dsl')?.cohort).toBe(original.cohort);
  expect(transport.artifact.mock.calls.every(([url]) => url.endsWith('/manifest.json'))).toBe(true);
});

it('backtracks artifact cohorts when a later parent constrains an explicitly selected dependency', async () => {
  const { snapshot, transport, releases, artifacts } = await referenceFixture(
    {
      cdm: { repository: repository('cdm'), release: '1.0' },
      fpml: { repository: repository('fpml'), release: '1.0' }
    },
    [
      ['cdm', '1.0', {}],
      ['fpml', '1.0', { cdm: { modelId: 'cdm', release: '1.0' } }]
    ]
  );
  const original = releases.get('cdm')![0]!;
  const variant = {
    ...original,
    cohort: 'cohort-' + 'f'.repeat(64),
    manifest: 'https://mirror.example/curated/cdm/artifacts/cohort-' + 'f'.repeat(64) + '/manifest.json'
  };
  const manifest = {
    ...JSON.parse(new TextDecoder().decode(artifacts.get(original.manifest))),
    cohort: variant.cohort
  };
  const bytes = new TextEncoder().encode(JSON.stringify(manifest));
  const { projectBytesRevision } = await import('@rune-langium/project-config');
  variant.checksum = await projectBytesRevision(bytes);
  releases.get('cdm')!.push(variant);
  artifacts.set(variant.manifest, bytes);
  const result = await resolveProjectReferences(snapshot, transport, signal());
  expect(result.diagnostics).toEqual([]);
  expect(result.lock!.references.cdm!.cohort).toBe(original.cohort);
  expect(transport.artifact.mock.calls.some(([url]) => url === variant.manifest)).toBe(true);
});

it('keeps reference locks fresh across source, example and build-target edits', async () => {
  const { snapshot, transport } = await referenceFixture();
  const lock = (await resolveProjectReferences(snapshot, transport, signal())).lock!;
  const { createProjectSnapshot } = await import('@rune-langium/project-config');
  const files = new Map(snapshot.files);
  files.set('build-config.lock.json', JSON.stringify(lock));
  files.set('model.rosetta', 'namespace local\ntype Local:');
  files.set('examples/one.json', '{}');
  files.set(
    'build-config.yml',
    JSON.stringify({ ...snapshot.project.build, targets: { sql: { generator: 'sql', output: 'out/sql' } } })
  );
  const edited = await createProjectSnapshot(snapshot.workspaceId, files, () => []);
  expect(edited.revision).not.toBe(snapshot.revision);
  expect(await projectReferenceLockDiagnostics(edited)).toEqual([]);
});
