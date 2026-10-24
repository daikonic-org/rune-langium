// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { describe, expect, it } from 'vitest';
import { createOpfsRoot } from '../setup/opfs-mock.js';
import { createProjectFileAdapter } from '../../src/workspace/project-file-adapter.js';
import { createProjectController } from '../../src/workspace/project-controller.js';
import {
  detectProjectInitialization,
  createGitHubInitializationSession
} from '../../src/workspace/project-initialization.js';

const pom =
  '<project><modelVersion>4.0.0</modelVersion><groupId>example</groupId><artifactId>demo</artifactId><version>1</version><profiles><profile><id>extra</id><properties><extra>true</extra></properties></profile></profiles></project>';
async function setup() {
  const adapter = createProjectFileAdapter({
    workspaceId: 'cloned',
    root: createOpfsRoot() as unknown as FileSystemDirectoryHandle,
    privateRoot: createOpfsRoot() as unknown as FileSystemDirectoryHandle,
    isWritable: () => true
  });
  await adapter.write('pom.xml', pom, null);
  const controller = createProjectController({ workspaceId: 'cloned', adapter, validateTarget: () => [] });
  return { adapter, controller };
}
describe('GitHub project initialization', () => {
  it.each(['yml', 'yaml'])('keeps existing build-config.%s authoritative without inspecting POM', (suffix) => {
    expect(
      detectProjectInitialization(
        new Map([
          ['build-config.' + suffix, 'invalid yaml is still authoritative'],
          ['pom.xml', 'invalid xml']
        ])
      )
    ).toEqual({ kind: 'configured' });
  });
  it('diagnoses ambiguous companion spellings rather than proposing an overwrite', () => {
    expect(() =>
      detectProjectInitialization(
        new Map([
          ['build-config.yml', ''],
          ['build-config.yaml', ''],
          ['pom.xml', pom]
        ])
      )
    ).toThrow();
  });
  it('distinguishes ordinary and Maven repositories', () => {
    expect(detectProjectInitialization(new Map([['demo.rosetta', 'namespace demo']]))).toEqual({ kind: 'plain' });
    expect(detectProjectInitialization(new Map([['pom.xml', pom]]))).toEqual({ kind: 'maven', pomPath: 'pom.xml' });
  });
  it('previews profiles and settings without changing the cloned files', async () => {
    const { adapter, controller } = await setup();
    const before = await adapter.read('pom.xml');
    const session = await createGitHubInitializationSession(controller);
    const preview = await session!.prepare(['extra']);
    expect(preview.provenance.profiles).toEqual(['extra']);
    expect(preview.writes.some((write) => write.path === 'build-config.yml')).toBe(true);
    expect(await adapter.list()).toEqual(['pom.xml']);
    session!.dispose();
    expect(await adapter.read('pom.xml')).toEqual(before);
  });
  it('saves reviewed settings and report while preserving POM bytes', async () => {
    const { adapter, controller } = await setup();
    const original = await adapter.read('pom.xml');
    const session = (await createGitHubInitializationSession(controller))!;
    const preview = await session.prepare([]);
    const saved = await session.save(preview);
    expect(saved.project.build.importReport).toBeDefined();
    expect(saved.files.has(saved.project.build.importReport!)).toBe(true);
    expect(await adapter.read('pom.xml')).toEqual(original);
  });
  it('rejects a stale POM even though the ordinary build snapshot revision is unchanged', async () => {
    const { adapter, controller } = await setup();
    const session = (await createGitHubInitializationSession(controller))!;
    const preview = await session.prepare([]);
    const previousRevision = session.snapshot.revision;
    const original = (await adapter.read('pom.xml'))!;
    await adapter.write('pom.xml', pom + '\n<!-- newer -->', original.revision);
    expect((await controller.load()).revision).toBe(previousRevision);
    await expect(session.save(preview)).rejects.toThrow();
    expect(preview.writes.length).toBeGreaterThan(0);
    expect(await adapter.read('build-config.yml')).toBeUndefined();
    expect((await adapter.read('pom.xml'))?.text).toContain('newer');
  });
  it('refuses a companion added after review, preserving the original preview', async () => {
    const { adapter, controller } = await setup();
    const session = (await createGitHubInitializationSession(controller))!;
    const preview = await session.prepare([]);
    await adapter.write('build-config.yaml', 'schemaVersion: 1\n', null);
    await expect(session.save(preview)).rejects.toThrow();
    expect(await adapter.read('build-config.yml')).toBeUndefined();
    expect((await adapter.read('build-config.yaml'))?.text).toBe('schemaVersion: 1\n');
  });
  it('opens plain and already configured clones without an initialization session', async () => {
    for (const configured of [false, true]) {
      const { adapter, controller } = await setup();
      await adapter.remove('pom.xml', (await adapter.read('pom.xml'))!.revision);
      if (configured) {
        await adapter.write('build-config.yml', 'schemaVersion: 1\n', null);
        await adapter.write('rune-config.yml', 'model:\n  name: demo\n', null);
      }
      expect(await createGitHubInitializationSession(controller)).toBeUndefined();
    }
  });
});

it('can explicitly re-review newer source files after a Save conflict', async () => {
  const { adapter, controller } = await setup();
  const session = (await createGitHubInitializationSession(controller))!;
  const first = await session.prepare([]);
  const before = (await adapter.read('pom.xml'))!;
  const nextRevision = await adapter.write(
    'pom.xml',
    pom.replace('<artifactId>demo</artifactId>', '<artifactId>updated</artifactId>'),
    before.revision
  );
  await expect(session.save(first)).rejects.toThrow();
  const reviewed = await session.prepare(['extra']);
  expect(reviewed.preconditions.inputs).toContainEqual({ path: 'pom.xml', revision: nextRevision });
  expect(reviewed.provenance.artifactId).toBe('updated');
  expect((await session.save(reviewed)).project.rune).toEqual({ model: { name: 'updated' } });
});
