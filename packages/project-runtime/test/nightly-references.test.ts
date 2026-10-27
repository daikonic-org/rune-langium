// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { expect, it, vi } from 'vitest';
import { CURATED_MODEL_REPOSITORIES, type CuratedManifest } from '@rune-langium/curated-schema';
import { createProjectSnapshot } from '@rune-langium/project-config';
import { referenceFixture } from '../../../test/helpers/project-reference-fixture.js';
import {
  loadProjectReferences,
  createMemoryReferenceCache,
  resolveProjectReferences,
  projectReferenceLockDiagnostics
} from '../src/references/index.js';

async function nightlyFixture(dependencies = true) {
  const fixture = await referenceFixture(
    { cdm: { repository: CURATED_MODEL_REPOSITORIES.cdm, release: 'nightly' } },
    dependencies ? undefined : [['cdm', '1.0', {}]]
  );
  const manifests = new Map<string, CuratedManifest>();
  for (const [id, releases] of fixture.releases)
    manifests.set(id, JSON.parse(new TextDecoder().decode(fixture.artifacts.get(releases[0]!.manifest)!)));
  const transport = { ...fixture.transport, nightly: vi.fn(async (id: string) => structuredClone(manifests.get(id)!)) };
  return { ...fixture, manifests, transport };
}

it('loads the current Nightly dependency closure without a catalog, pin, or lockfile', async () => {
  const fixture = await nightlyFixture();
  expect(await projectReferenceLockDiagnostics(fixture.snapshot)).toEqual([]);
  const result = await loadProjectReferences(
    fixture.snapshot,
    fixture.transport,
    createMemoryReferenceCache(),
    new AbortController().signal
  );
  expect(result.diagnostics).toEqual([]);
  expect(result.documents.map((doc) => doc.uri)).toEqual(['cdm/model.rosetta', 'rune-dsl/model.rosetta']);
  for (const document of result.documents) {
    const model = document.uri.split('/')[0]!;
    expect(document.cohort).toBe(fixture.manifests.get(model)!.cohort);
    expect(document.source).toMatchObject({
      model,
      release: 'nightly',
      commit: fixture.manifests.get(model)!.upstreamCommit
    });
  }
  expect(fixture.transport.catalog).not.toHaveBeenCalled();
  expect(fixture.snapshot.lock).toBeUndefined();
  const prepared = await resolveProjectReferences(fixture.snapshot, fixture.transport, new AbortController().signal);
  expect(prepared.lock?.references).toEqual({});
});

it('follows a new mirror publication on refresh even when the previous bytes are cached or retired', async () => {
  const fixture = await nightlyFixture(false);
  const cache = createMemoryReferenceCache(),
    signal = new AbortController().signal;
  const first = await loadProjectReferences(fixture.snapshot, fixture.transport, cache, signal);
  expect(first.diagnostics).toEqual([]);
  const manifest = fixture.manifests.get('cdm')!;
  const artifact = manifest.artifacts!.serializedWorkspace!;
  const bundle = JSON.parse(gunzipSync(fixture.artifacts.get(artifact.url)!).toString());
  bundle.documents[0].content += '\n// Current Nightly\n';
  const bytes = gzipSync(JSON.stringify(bundle));
  fixture.artifacts.delete(artifact.url);
  artifact.sha256 = createHash('sha256').update(bytes).digest('hex');
  artifact.sizeBytes = bytes.byteLength;
  artifact.url = artifact.url.replace(/[^/]+$/, artifact.sha256 + '.serialized.json.gz');
  fixture.artifacts.set(artifact.url, bytes);
  manifest.upstreamCommit = 'f'.repeat(40);
  const second = await loadProjectReferences(fixture.snapshot, fixture.transport, cache, signal);
  expect(second.diagnostics).toEqual([]);
  expect(second.documents[0]!.content).toContain('Current Nightly');
  expect(fixture.transport.nightly).toHaveBeenCalledTimes(2);
  expect(fixture.snapshot.lock).toBeUndefined();
});

it('rejects a partial Nightly publication and never exposes a mismatched dependency closure', async () => {
  const fixture = await nightlyFixture();
  fixture.manifests.get('rune-dsl')!.cohort = 'cohort-' + 'f'.repeat(64);
  const result = await loadProjectReferences(
    fixture.snapshot,
    fixture.transport,
    createMemoryReferenceCache(),
    new AbortController().signal
  );
  expect(result.documents).toEqual([]);
  expect(result.diagnostics[0]?.code).toBe('REFERENCE_DEPENDENCY');
});

it('retains checksum and repository guards for moving Nightly data', async () => {
  const fixture = await nightlyFixture(false);
  fixture.artifacts.set(fixture.manifests.get('cdm')!.artifacts!.serializedWorkspace!.url, new Uint8Array([1, 2]));
  const corrupt = await loadProjectReferences(
    fixture.snapshot,
    fixture.transport,
    createMemoryReferenceCache(),
    new AbortController().signal
  );
  expect(corrupt.documents).toEqual([]);
  expect(corrupt.diagnostics[0]?.code).toBe('REFERENCE_CHECKSUM');
  const files = new Map(fixture.snapshot.files);
  files.set(
    'build-config.yml',
    JSON.stringify({
      schemaVersion: 1,
      references: { cdm: { repository: 'https://github.com/other/model', release: 'nightly' } }
    })
  );
  const wrong = await loadProjectReferences(
    await createProjectSnapshot('wrong', files, () => []),
    fixture.transport,
    createMemoryReferenceCache(),
    new AbortController().signal
  );
  expect(wrong.diagnostics[0]?.code).toBe('REFERENCE_CONFLICT');
});

it('keeps tagged dependency conflicts explicit instead of silently substituting Nightly', async () => {
  const fixture = await referenceFixture({
    cdm: { repository: 'https://github.com/org/cdm', release: '1.0' },
    'rune-dsl': { repository: CURATED_MODEL_REPOSITORIES['rune-dsl'], release: 'nightly' }
  });
  const result = await resolveProjectReferences(fixture.snapshot, fixture.transport, new AbortController().signal);
  expect(result.lock).toBeUndefined();
  expect(result.diagnostics[0]?.code).toBe('REFERENCE_CONFLICT');
});
