// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { describe, it, expect } from 'vitest';
import { validateReferenceCatalog } from '../src/index.js';
const cohort = 'cohort-' + 'a'.repeat(64);
const release = {
  modelId: 'cdm',
  repository: 'https://github.com/finos/common-domain-model',
  tag: '6.0.0',
  commit: 'b'.repeat(40),
  manifest: `https://mirror.example/curated/cdm/artifacts/${cohort}/manifest.json`,
  cohort,
  checksum: 'c'.repeat(64),
  dependencies: { fpml: { modelId: 'fpml', release: '3.5.0' } },
  toolchain: 'rune-langium/0.1.0;langium/4.4.0'
};
describe('reference release catalogs', () => {
  it('retains exact source and artifact identity through JSON round trips', () => {
    const catalog = { schemaVersion: 1, releases: [release] };
    expect(validateReferenceCatalog(JSON.parse(JSON.stringify(catalog)))).toEqual(catalog);
  });
  it('rejects latest manifest pointers and malformed hashes', () => {
    for (const bad of [
      { manifest: 'https://mirror.example/curated/cdm/manifest.json' },
      { checksum: 'wrong' },
      { commit: 'master' },
      { cohort: 'latest' }
    ])
      expect(() => validateReferenceCatalog({ schemaVersion: 1, releases: [{ ...release, ...bad }] })).toThrow();
  });
  it('rejects ambiguous duplicate model and release entries', () => {
    expect(() =>
      validateReferenceCatalog({ schemaVersion: 1, releases: [release, { ...release, commit: 'd'.repeat(40) }] })
    ).toThrow();
  });
});

it('retains distinct immutable artifact cohorts for the same source release', () => {
  const variant = {
    ...release,
    cohort: 'cohort-' + 'd'.repeat(64),
    manifest: 'https://mirror.example/curated/cdm/artifacts/cohort-' + 'd'.repeat(64) + '/manifest.json',
    checksum: 'e'.repeat(64)
  };
  expect(validateReferenceCatalog({ schemaVersion: 1, releases: [release, variant] }).releases).toHaveLength(2);
});
it('retains explicit Maven artifact coordinates without treating Maven versions as release tags', () => {
  const mavenArtifacts = [
    { groupId: 'org.example', artifactId: 'model', version: '1.2.3', type: 'jar', classifier: 'sources' }
  ];
  expect(
    validateReferenceCatalog({ schemaVersion: 1, releases: [{ ...release, tag: 'release-special', mavenArtifacts }] })
      .releases[0]
  ).toHaveProperty('mavenArtifacts', mavenArtifacts);
});
