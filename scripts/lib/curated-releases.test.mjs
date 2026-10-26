// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { prepareCuratedReleasePublication, publishCuratedReleaseCatalogs } from './curated-releases.mjs';
const cohort = 'cohort-' + 'a'.repeat(64);
const base = 'https://mirror.example';
const sources = ['cdm', 'fpml', 'rune-dsl'].map((id, index) => ({
  id,
  owner: 'org',
  repo: id,
  ref: '1.0.0',
  commit: String(index + 1).repeat(40),
  release: { tag: '1.0.0', commit: String(index + 1).repeat(40) }
}));
function fixture() {
  const manifests = new Map(
    sources.map((source) => [
      source.id,
      JSON.stringify({
        schemaVersion: 2,
        modelId: source.id,
        version: '2026-10-23',
        sha256: 'a'.repeat(64),
        sizeBytes: 1,
        generatedAt: '2026-10-23T00:00:00Z',
        upstreamCommit: source.commit,
        upstreamRef: source.ref,
        archiveUrl: `${base}/curated/${source.id}/artifacts/2026-10-23-hash.source.tar.gz`,
        history: [],
        cohort,
        dependencies:
          source.id === 'cdm'
            ? { fpml: cohort, 'rune-dsl': cohort }
            : source.id === 'fpml'
              ? { 'rune-dsl': cohort }
              : {},
        artifacts: {
          serializedWorkspace: {
            schemaVersion: 1,
            kind: 'langium-json-serializer',
            url: `${base}/curated/${source.id}/artifacts/2026-10-23-hash.serialized.json.gz`,
            sha256: 'b'.repeat(64),
            sizeBytes: 1,
            documentCount: 1,
            langiumVersion: '4.4.0'
          }
        },
        namespaces: {
          [source.id]: {
            deps: [],
            exports: [],
            artifact: `${base}/curated/${source.id}/artifacts/2026-10-23-hash/ns/${source.id}.json.gz`
          }
        }
      })
    ])
  );
  return {
    sources: structuredClone(sources),
    manifests,
    catalogs: new Map(),
    baseUrl: base,
    toolchain: 'rune-langium/0.1.0;langium/4.4.0'
  };
}
test('prepares exact release mappings from explicit source tags and existing cohort manifests', () => {
  const input = fixture();
  const plan = prepareCuratedReleasePublication(input);
  const cdm = plan.catalogs.get('cdm').releases[0];
  assert.equal(cdm.commit, sources[0].commit);
  assert.equal(cdm.tag, '1.0.0');
  assert.equal(cdm.checksum, createHash('sha256').update(input.manifests.get('cdm')).digest('hex'));
  assert.equal(cdm.manifest, `${base}/curated/cdm/artifacts/${cohort}/manifest.json`);
  assert.deepEqual(cdm.dependencies, {
    fpml: { modelId: 'fpml', release: '1.0.0' },
    'rune-dsl': { modelId: 'rune-dsl', release: '1.0.0' }
  });
});
test('never advertises development refs or guesses tags from artifact versions', () => {
  const input = fixture();
  input.sources = input.sources.map(({ release: _release, ...source }) => source);
  assert.equal(prepareCuratedReleasePublication(input).catalogs.size, 0);
});
test('does not advance any release when dependency artifacts or manifests were not fully uploaded', async () => {
  const plan = prepareCuratedReleasePublication(fixture());
  const writes = [];
  await assert.rejects(
    publishCuratedReleaseCatalogs(plan, {
      published: new Set(plan.requiredObjects.filter((key) => !key.includes('/fpml/'))),
      put: async (key) => writes.push(key)
    }),
    /not published/
  );
  assert.deepEqual(writes, []);
});
test('requires immutable source archives and their successful upload receipts', async () => {
  const input = fixture();
  const plan = prepareCuratedReleasePublication(input);
  const writes = [];
  await assert.rejects(
    publishCuratedReleaseCatalogs(plan, {
      published: new Set(plan.requiredObjects.filter((key) => !key.endsWith('.source.tar.gz'))),
      put: async (key) => writes.push(key)
    }),
    /not published/
  );
  assert.deepEqual(writes, []);
  input.manifests.set(
    'cdm',
    JSON.stringify({ ...JSON.parse(input.manifests.get('cdm')), archiveUrl: `${base}/curated/cdm/latest.tar.gz` })
  );
  assert.throws(() => prepareCuratedReleasePublication(input), /not immutable/);
});
test('publishes dependencies before consumers and stops on a dependency catalog failure', async () => {
  const plan = prepareCuratedReleasePublication(fixture());
  const writes = [];
  await assert.rejects(
    publishCuratedReleaseCatalogs(plan, {
      published: new Set(plan.requiredObjects),
      put: async (key) => {
        writes.push(key);
        if (key === 'releases/fpml.json') throw new Error('interrupted');
      }
    }),
    /interrupted/
  );
  assert.deepEqual(writes, ['releases/rune-dsl.json', 'releases/fpml.json']);
});
test('rejects moved tags and missing or mismatched dependency provenance before publication', () => {
  const input = fixture();
  const previous = prepareCuratedReleasePublication(input).catalogs;
  assert.throws(
    () =>
      prepareCuratedReleasePublication({
        ...input,
        catalogs: previous,
        sources: input.sources.map((source) =>
          source.id === 'cdm'
            ? { ...source, commit: 'f'.repeat(40), release: { ...source.release, commit: 'f'.repeat(40) } }
            : source
        )
      }),
    /provenance|moved/i
  );
  const moved = fixture();
  moved.sources[0].commit = 'f'.repeat(40);
  moved.sources[0].release.commit = moved.sources[0].commit;
  moved.manifests.set(
    'cdm',
    JSON.stringify({ ...JSON.parse(moved.manifests.get('cdm')), upstreamCommit: moved.sources[0].commit })
  );
  assert.throws(() => prepareCuratedReleasePublication({ ...moved, catalogs: previous }), /Moved release tag/);
  const missing = fixture();
  missing.manifests.delete('fpml');
  assert.throws(() => prepareCuratedReleasePublication(missing), /manifest/i);
  const untagged = fixture();
  delete untagged.sources[1].release;
  assert.throws(() => prepareCuratedReleasePublication(untagged), /release/i);
});

test('retains previous immutable cohorts when a source release is rebuilt in a new compatible set', () => {
  const before = fixture();
  const old = prepareCuratedReleasePublication(before).catalogs;
  const next = fixture();
  const cohort = 'cohort-' + 'f'.repeat(64);
  for (const [id, text] of next.manifests) {
    const manifest = JSON.parse(text);
    manifest.cohort = cohort;
    manifest.dependencies = Object.fromEntries(Object.keys(manifest.dependencies).map((id) => [id, cohort]));
    next.manifests.set(id, JSON.stringify(manifest));
  }
  const updated = prepareCuratedReleasePublication({ ...next, catalogs: old }).catalogs;
  for (const [id, catalog] of updated) {
    assert.equal(catalog.releases.length, 2);
    assert.equal(catalog.releases[0].cohort, old.get(id).releases[0].cohort);
  }
});
