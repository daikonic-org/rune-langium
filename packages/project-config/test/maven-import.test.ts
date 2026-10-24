// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { inspectMavenProject } from '../src/import/maven.js';
import { BuildConfigSchema } from '../src/config-schema.js';
const fixture = (name: string) => readFile(new URL(`./fixtures/maven/${name}.xml`, import.meta.url), 'utf8');
it('proposes distinct targets for supported metadata without claiming Java generator support or changing POM bytes', async () => {
  const pom = await fixture('minimal');
  const files = new Map([['pom.xml', pom]]);
  const preview = inspectMavenProject(files, { pomPath: 'pom.xml', profiles: [] });
  expect(BuildConfigSchema.safeParse(preview.build).success).toBe(true);
  expect(preview.build.sources).toEqual(
    expect.arrayContaining(['src/main/rosetta/**/*.rosetta', 'src/other/rosetta/**/*.rosetta'])
  );
  expect(Object.values(preview.build.targets).map((target) => target.output)).toEqual([
    'generated/first',
    'generated/second'
  ]);
  expect(Object.values(preview.build.targets).every((target) => target.generator === 'java')).toBe(true);
  expect(
    preview.report.some((item) => item.status === 'unsupported' && item.capabilities.includes('generator:java'))
  ).toBe(true);
  expect(preview.writes.every((write) => write.path !== 'pom.xml' && write.expectedRevision === null)).toBe(true);
  expect(preview.writes.some((write) => write.path === 'rune-config.yml')).toBe(true);
  expect(JSON.parse(preview.writes.find((write) => write.path === preview.build.importReport)!.text).report).toEqual(
    preview.report
  );
  expect(files.get('pom.xml')).toBe(pom);
  expect('defaultTarget' in preview.build).toBe(false);
});
it('resolves local parent properties and dependency management with source origins and coordinate evidence', () => {
  const files = new Map([
    [
      'pom.xml',
      '<project><groupId>demo</groupId><artifactId>parent</artifactId><version>1</version><properties><model.version>3.5.0</model.version></properties><dependencyManagement><dependencies><dependency><groupId>com.regnosys.rune-fpml</groupId><artifactId>rosetta-source</artifactId><version>${model.version}</version></dependency></dependencies></dependencyManagement></project>'
    ],
    [
      'child/pom.xml',
      '<project><parent><relativePath>../pom.xml</relativePath></parent><artifactId>child</artifactId><dependencies><dependency><groupId>com.regnosys.rune-fpml</groupId><artifactId>rosetta-source</artifactId><scope>provided</scope><exclusions><exclusion><groupId>x</groupId><artifactId>y</artifactId></exclusion></exclusions></dependency></dependencies></project>'
    ]
  ]);
  const preview = inspectMavenProject(files, { pomPath: 'child/pom.xml', profiles: [] });
  expect(preview.dependencies).toContainEqual(
    expect.objectContaining({
      groupId: 'com.regnosys.rune-fpml',
      artifactId: 'rosetta-source',
      version: '3.5.0',
      type: 'jar',
      scope: 'provided',
      exclusions: [{ groupId: 'x', artifactId: 'y' }],
      path: expect.stringContaining('child/pom.xml')
    })
  );
});
it('uses explicit profiles rather than OS/JDK/settings/default activation', async () => {
  const files = new Map([['pom.xml', await fixture('profiles')]]);
  const none = inspectMavenProject(files, { pomPath: 'pom.xml', profiles: [] });
  expect(none.dependencies).toEqual([]);
  expect(none.report.some((item) => item.code === 'MAVEN_PROFILE_ACTIVATION' && item.status === 'unresolved')).toBe(
    true
  );
  const chosen = inspectMavenProject(files, { pomPath: 'pom.xml', profiles: ['dev'] });
  expect(chosen.dependencies[0]?.version).toBe('2');
  expect(chosen.provenance.profiles).toEqual(['dev']);
});
it('reports unresolved parents/interpolation, filtering and unknown executable plugins as data only', async () => {
  const unresolved = inspectMavenProject(new Map([['pom.xml', await fixture('unresolved-parent')]]), {
    pomPath: 'pom.xml',
    profiles: []
  });
  expect(unresolved.report.map((item) => item.code)).toEqual(
    expect.arrayContaining(['MAVEN_PARENT_UNRESOLVED', 'MAVEN_PROPERTY_UNRESOLVED'])
  );
  const unknown = inspectMavenProject(new Map([['pom.xml', await fixture('unknown-plugin')]]), {
    pomPath: 'pom.xml',
    profiles: []
  });
  expect(unknown.report.map((item) => item.code)).toEqual(
    expect.arrayContaining(['MAVEN_FILTERING', 'MAVEN_PLUGIN_UNSUPPORTED'])
  );
  expect(JSON.stringify(unknown.report)).toContain('never-execute');
});
it('rejects XML entities and bounds parent cycles without fetching external metadata', () => {
  const entity = inspectMavenProject(
    new Map([
      [
        'pom.xml',
        '<!DOCTYPE project [<!ENTITY x SYSTEM "https://example.com/never">]><project><name>&x;</name></project>'
      ]
    ]),
    { pomPath: 'pom.xml', profiles: [] }
  );
  expect(entity.report.some((item) => item.code === 'MAVEN_XML_UNSAFE')).toBe(true);
  expect(entity.writes).toEqual([]);
  const cycle = inspectMavenProject(
    new Map([
      ['pom.xml', '<project><parent><relativePath>child/pom.xml</relativePath></parent></project>'],
      ['child/pom.xml', '<project><parent><relativePath>../pom.xml</relativePath></parent></project>']
    ]),
    { pomPath: 'pom.xml', profiles: [] }
  );
  expect(cycle.report.some((item) => item.code === 'MAVEN_PARENT_CYCLE')).toBe(true);
});
it('accepts namespace-qualified XML and never overwrites existing native settings', () => {
  const preview = inspectMavenProject(
    new Map([
      [
        'pom.xml',
        '<m:project xmlns:m="http://maven.apache.org/POM/4.0.0"><m:artifactId>demo</m:artifactId></m:project>'
      ],
      ['build-config.yaml', 'schemaVersion: 1']
    ]),
    { pomPath: 'pom.xml', profiles: [] }
  );
  expect(preview.writes).toEqual([]);
  expect(preview.report.some((item) => item.code === 'MAVEN_ALREADY_CONFIGURED')).toBe(true);
});
it('keeps module source/config paths rooted once and reports generated inputs instead of inventing them', async () => {
  const pom = (await fixture('minimal'))
    .replace('src/main/rosetta', '$' + '{project.basedir}/src/main/rosetta')
    .replace('src/other/rosetta', '$' + '{project.build.directory}/classes/cdm');
  const preview = inspectMavenProject(new Map([['model/pom.xml', pom]]), { pomPath: 'model/pom.xml', profiles: [] });
  expect(preview.build.sources).toContain('model/src/main/rosetta/**/*.rosetta');
  expect(preview.report.find((item) => item.code === 'MAVEN_GENERATED_SOURCE')?.evidence).toBe(
    'model/target/classes/cdm'
  );
});
it('uses selected profile modules and resource settings, keeping unselected profiles inactive', () => {
  const files = new Map([
    [
      'pom.xml',
      '<project><artifactId>root</artifactId><profiles><profile><id>extra</id><modules><module>child</module></modules><build><resources><resource><directory>profile-resources</directory></resource></resources></build></profile></profiles></project>'
    ],
    ['child/pom.xml', '<project><artifactId>child</artifactId></project>']
  ]);
  const preview = inspectMavenProject(files, { pomPath: 'pom.xml', profiles: ['extra'] });
  expect(preview.provenance.documents).toContain('child/pom.xml');
  expect(preview.build.resources).toContainEqual({ path: 'profile-resources' });
  expect(inspectMavenProject(files, { pomPath: 'pom.xml', profiles: [] }).provenance.documents).not.toContain(
    'child/pom.xml'
  );
});
it('bounds recursive property growth and diagnoses module paths that escape the repository', () => {
  const properties =
    Array.from(
      { length: 24 },
      (_, index) => '<p' + index + '>$' + '{p' + (index + 1) + '}$' + '{p' + (index + 1) + '}</p' + index + '>'
    ).join('') + '<p24>xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx</p24>';
  const pom =
    '<project><artifactId>bounded</artifactId><properties>' +
    properties +
    '</properties><modules><module>../../outside</module></modules><dependencies><dependency><groupId>x</groupId><artifactId>y</artifactId><version>$' +
    '{p0}</version></dependency></dependencies></project>';
  const preview = inspectMavenProject(new Map([['pom.xml', pom]]), { pomPath: 'pom.xml', profiles: [] });
  expect(preview.report.some((item) => item.code === 'MAVEN_PROPERTY_UNRESOLVED')).toBe(true);
  expect(preview.report.some((item) => item.code === 'MAVEN_PATH_UNRESOLVED')).toBe(true);
  expect(JSON.stringify(preview).length).toBeLessThan(1000000);
});
it('includes persisted import evidence in revision identity and protects it from generated output', async () => {
  const { createProjectSnapshot } = await import('../src/project-snapshot.js');
  const config = JSON.stringify({
    schemaVersion: 1,
    importReport: 'evidence/import.json',
    targets: { bad: { generator: 'json-schema', output: 'evidence' } }
  });
  const files = new Map([
    ['rune-config.yml', 'model: {name: Import}'],
    ['build-config.yml', config],
    ['evidence/import.json', '{}']
  ]);
  const first = await createProjectSnapshot('p', files, () => []);
  const second = await createProjectSnapshot(
    'p',
    new Map([...files, ['evidence/import.json', '{"changed":true}']]),
    () => []
  );
  expect(second.revision).not.toBe(first.revision);
  expect(first.project.diagnostics.some((item) => item.code === 'OUTPUT_PROTECTED' && item.target === 'bad')).toBe(
    true
  );
});
it.each(['cdm', 'fpml'])(
  'retains the pinned %s coordinates, paths and unavailable Java/filtering requirements',
  async (id) => {
    const { createHash } = await import('node:crypto');
    const root = new URL('../../../test/fixtures/third-party/project-import/', import.meta.url);
    const manifest: { id: string; path: string; sha256: string; commit: string }[] = JSON.parse(
      await readFile(new URL('sources.json', root), 'utf8')
    );
    const files = new Map<string, string>();
    for (const entry of manifest.filter((entry) => entry.id === id)) {
      const bytes = await readFile(new URL(id + '/' + entry.path, root));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
      expect(entry.commit).toMatch(/^[a-f0-9]{40}$/);
      files.set(entry.path, bytes.toString('utf8'));
    }
    const before = [...files];
    const preview = inspectMavenProject(files, { pomPath: 'pom.xml', profiles: [] });
    expect(preview.build.sources).toContain('rosetta-source/src/main/rosetta/**/*.rosetta');
    expect(
      Object.values(preview.build.targets).some(
        (target) => target.generator === 'java' && target.output === 'rosetta-source/src/generated/java'
      )
    ).toBe(true);
    expect(preview.report.some((item) => item.code === 'MAVEN_GENERATED_SOURCE')).toBe(true);
    expect(preview.report.some((item) => item.code === 'MAVEN_FILTERING')).toBe(true);
    expect(preview.report.some((item) => item.code === 'MAVEN_GENERATOR_UNAVAILABLE')).toBe(true);
    expect([...files]).toEqual(before);
  }
);
it('keeps partial initialization editable while unavailable generators stay target scoped', async () => {
  const { createProjectSnapshot } = await import('../src/project-snapshot.js');
  const preview = inspectMavenProject(new Map([['pom.xml', await fixture('minimal')]]), {
    pomPath: 'pom.xml',
    profiles: []
  });
  const files = new Map([
    ['pom.xml', await fixture('minimal')],
    ...preview.writes.map((write) => [write.path, write.text] as const)
  ]);
  const snapshot = await createProjectSnapshot('p', files, () => [
    { code: 'TARGET_UNAVAILABLE', path: 'targets', severity: 'error', message: 'Java generator unavailable.' }
  ]);
  expect(snapshot.project.diagnostics.every((item) => item.target)).toBe(true);
  expect(snapshot.files.get('pom.xml')).toBe(await fixture('minimal'));
});
it('diagnoses ambiguous native companion spellings without selecting one or proposing writes', () => {
  const preview = inspectMavenProject(
    new Map([
      ['pom.xml', '<project><artifactId>x</artifactId></project>'],
      ['build-config.yml', 'schemaVersion: 1'],
      ['build-config.yaml', 'schemaVersion: 1']
    ]),
    { pomPath: 'pom.xml', profiles: [] }
  );
  expect(preview.writes).toEqual([]);
  expect(preview.report.some((item) => item.code === 'MAVEN_CONFIG_AMBIGUOUS')).toBe(true);
});
