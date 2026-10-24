// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { afterEach, expect, it } from 'vitest';
import { readFile, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { openLocalProject } from '../src/local-project.js';
import { buildProject } from '../src/build-project.js';
import { buildEffectiveProject } from '../src/effective-project.js';
import { mavenInitializationFixture, withLocalRuneImplementation } from '../../../test/helpers/maven-project.js';
import { projectInitializationStatus } from '../src/import/project-status.js';
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function initialized(name: 'cdm' | 'fpml') {
  const parent = await mkdtemp(join(tmpdir(), 'rune-initialization-'));
  roots.push(parent);
  const root = join(parent, 'project');
  await mkdir(root);
  const { input, files, preview } = await mavenInitializationFixture(name);
  for (const [path, text] of files) {
    await mkdir(dirname(join(root, path!)), { recursive: true });
    await writeFile(join(root, path!), text!);
  }
  return { root, parent, preview, input, ...(await openLocalProject(root, { privateRoot: join(parent, 'private') })) };
}
it.each(['cdm', 'fpml'] as const)(
  'keeps pinned %s Maven evidence while reporting independently available native targets',
  async (name) => {
    const { snapshot, adapter, preview, root, input } = await initialized(name);
    const graph = await buildEffectiveProject(snapshot, []);
    expect(graph.diagnostics).toEqual([]);
    const status = projectInitializationStatus(snapshot, graph.capabilities);
    const importedNames = Object.keys(preview.build.targets).filter((name) => !['types', 'schedule'].includes(name));
    expect(importedNames.length).toBeGreaterThan(0);
    for (const name of importedNames)
      expect(status.targets.find((target) => target.name === name)?.status).toBe('unavailable');
    expect(status.targets.find((target) => target.name === 'types')?.status).toBe('configured');
    expect(status.targets.find((target) => target.name === 'schedule')?.status).toBe('unavailable');
    expect(
      status.functions.some(
        (capability) =>
          capability.status === 'unavailable' &&
          capability.affectedFunctions.some((symbol) => symbol.name === 'CreatePaymentSchedule')
      )
    ).toBe(true);
    expect(status.report?.report.some((item) => item.status === 'unsupported')).toBe(true);
    expect((await buildProject(snapshot, { targets: ['types'] }, adapter)).status).toBe('success');
    expect((await buildProject(snapshot, { targets: ['schedule'] }, adapter)).status).toBe('failed');
    for (const [path, text] of input) expect(await readFile(join(root, path), 'utf8')).toBe(text);
  }
);
it('uses saved native config on reopen, then recovers execution with an explicit local Rune implementation', async () => {
  const { root, parent, snapshot, adapter, preview } = await initialized('cdm');
  await writeFile(join(root, 'pom.xml'), '<project>unrelated future POM</project>');
  const reopened = await openLocalProject(root, { privateRoot: join(parent, 'private') });
  expect(reopened.snapshot.revision).toBe(snapshot.revision);
  expect(projectInitializationStatus(reopened.snapshot, []).report?.provenance.documents).toEqual(
    preview.provenance.documents
  );
  const repairedFiles = withLocalRuneImplementation(new Map(), preview);
  await writeFile(join(root, 'build-config.yml'), repairedFiles.get('build-config.yml')!);
  await writeFile(join(root, 'model/payment.rosetta'), repairedFiles.get('model/payment.rosetta')!);
  const repaired = await openLocalProject(root, { privateRoot: join(parent, 'private') });
  const graph = await buildEffectiveProject(repaired.snapshot, []);
  const status = projectInitializationStatus(repaired.snapshot, graph.capabilities);
  expect(status.targets.find((target) => target.name === 'schedule')?.status).toBe('configured');
  const built = await buildProject(repaired.snapshot, { targets: ['schedule'] }, adapter);
  expect(built.status).toBe('success');
  expect(built.outputs.some((path) => path.endsWith('.ts'))).toBe(true);
  expect(status.report?.report.some((item) => item.status === 'unsupported')).toBe(true);
});

it('keeps native target configuration usable when saved import evidence is missing or malformed', async () => {
  const { createProjectSnapshot } = await import('@rune-langium/project-config');
  const { validateProjectTarget } = await import('../src/project-build.js');
  for (const report of [undefined, '{bad', '{"schemaVersion":2}']) {
    const files = new Map([
      ['rune-config.yml', 'model: {name: Example}'],
      [
        'build-config.yml',
        JSON.stringify({
          schemaVersion: 1,
          importReport: 'build-config.import.json',
          targets: { types: { generator: 'json-schema', output: 'generated/types' } }
        })
      ]
    ]);
    if (report !== undefined) files.set('build-config.import.json', report);
    const status = projectInitializationStatus(await createProjectSnapshot('p', files, validateProjectTarget), []);
    expect(status.report).toBeUndefined();
    expect(status.reportDiagnostics).toHaveLength(1);
    expect(status.targets).toEqual([{ name: 'types', status: 'configured', reasons: [] }]);
  }
});
it('uses current settings for two Maven execution targets after one is explicitly replaced with a native generator', async () => {
  const { inspectMavenProject, refreshMavenPreviewWrites, createProjectSnapshot } =
    await import('@rune-langium/project-config');
  const { validateProjectTarget } = await import('../src/project-build.js');
  const pom =
    '<project><artifactId>two</artifactId><build><plugins><plugin><groupId>org.finos.rune</groupId><artifactId>rune-maven-plugin</artifactId><version>10.10.0</version><executions><execution><id>one</id><goals><goal>generate</goal></goals></execution><execution><id>two</id><goals><goal>generate</goal></goals></execution></executions></plugin></plugins></build></project>';
  const files = new Map([['pom.xml', pom]]);
  const original = inspectMavenProject(files, { pomPath: 'pom.xml', profiles: [] });
  const names = Object.keys(original.build.targets);
  expect(names).toHaveLength(2);
  original.build.targets[names[0]!] = { generator: 'json-schema', output: 'generated/native', options: {} };
  const edited = refreshMavenPreviewWrites(original);
  for (const write of edited.writes) files.set(write.path, write.text);
  const status = projectInitializationStatus(await createProjectSnapshot('p', files, validateProjectTarget), []);
  expect(status.targets.find((target) => target.name === names[0])?.status).toBe('configured');
  expect(status.targets.find((target) => target.name === names[1])?.status).toBe('unavailable');
  expect(status.report?.report.filter((item) => item.status === 'unsupported').length).toBeGreaterThan(0);
});
