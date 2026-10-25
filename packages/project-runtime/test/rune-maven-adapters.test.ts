// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { expect, it } from 'vitest';
import { inspectMavenProject } from '@rune-langium/project-config';
import { mapMavenReferences } from '../src/import/rune-maven-adapters.js';
import { validateReferenceCatalog } from '@rune-langium/curated-schema';
const cohort = 'cohort-' + 'a'.repeat(64);
const release = {
  modelId: 'fpml',
  repository: 'https://github.com/rosetta-models/rune-fpml',
  tag: 'release-custom',
  commit: 'b'.repeat(40),
  cohort,
  checksum: 'c'.repeat(64),
  manifest: 'https://mirror.example/curated/fpml/artifacts/' + cohort + '/manifest.json',
  dependencies: {},
  toolchain: 'rune-langium/0.1.0;langium/4.4.0',
  mavenArtifacts: [{ groupId: 'com.regnosys.rune-fpml', artifactId: 'rosetta-source', version: '3.5.0', type: 'jar' }]
};
function preview() {
  return inspectMavenProject(
    new Map([
      [
        'pom.xml',
        '<project><artifactId>demo</artifactId><dependencies><dependency><groupId>com.regnosys.rune-fpml</groupId><artifactId>rosetta-source</artifactId><version>3.5.0</version></dependency></dependencies></project>'
      ]
    ]),
    { pomPath: 'pom.xml', profiles: [] }
  );
}
it('maps only explicit catalog coordinates, retaining different release-tag spelling and refreshed proposed writes', () => {
  const original = preview();
  const mapped = mapMavenReferences(original, validateReferenceCatalog({ schemaVersion: 1, releases: [release] }));
  expect(mapped.build.references.fpml).toEqual({ repository: release.repository, release: 'release-custom' });
  expect(mapped.report).toContainEqual(
    expect.objectContaining({ code: 'MAVEN_REFERENCE_MAPPED', status: 'translated' })
  );
  expect(mapped.writes.find((write) => write.path === 'build-config.yml')?.text).toContain('release-custom');
  expect(original.build.references).toEqual({});
});
it('does not infer tags from version equality and refuses ambiguous coordinate mappings', () => {
  const { mavenArtifacts, ...withoutMapping } = release;
  const missing = mapMavenReferences(
    preview(),
    validateReferenceCatalog({ schemaVersion: 1, releases: [{ ...withoutMapping, tag: '3.5.0' }] })
  );
  expect(missing.build.references).toEqual({});
  const ambiguous = mapMavenReferences(
    preview(),
    validateReferenceCatalog({
      schemaVersion: 1,
      releases: [release, { ...release, tag: 'other-release', commit: 'd'.repeat(40) }]
    })
  );
  expect(ambiguous.build.references).toEqual({});
  expect(ambiguous.report.some((item) => item.code === 'MAVEN_REFERENCE_AMBIGUOUS')).toBe(true);
});
it('does not map a different classifier or silently choose two releases for one model', () => {
  const input = preview();
  input.dependencies.push({ ...input.dependencies[0]!, classifier: 'sources', path: 'pom.xml#sources' });
  const mapped = mapMavenReferences(input, validateReferenceCatalog({ schemaVersion: 1, releases: [release] }));
  expect(mapped.report.some((item) => item.path === 'pom.xml#sources' && item.status === 'translated')).toBe(false);
  const versionTwo = {
    ...release,
    tag: 'other',
    commit: 'd'.repeat(40),
    mavenArtifacts: [{ ...release.mavenArtifacts[0]!, version: '4.0.0' }]
  };
  const conflict = preview();
  conflict.dependencies.push({ ...conflict.dependencies[0]!, version: '4.0.0', path: 'pom.xml#second' });
  expect(
    mapMavenReferences(conflict, validateReferenceCatalog({ schemaVersion: 1, releases: [release, versionTwo] })).build
      .references
  ).toEqual({});
});
