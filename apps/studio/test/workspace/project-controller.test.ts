// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { describe, expect, it } from 'vitest';
import { createOpfsRoot } from '../setup/opfs-mock.js';
import { createProjectFileAdapter } from '../../src/workspace/project-file-adapter.js';
import { createProjectController } from '../../src/workspace/project-controller.js';

async function setup() {
  const adapter = createProjectFileAdapter({
    workspaceId: 'project',
    root: createOpfsRoot() as unknown as FileSystemDirectoryHandle,
    privateRoot: createOpfsRoot() as unknown as FileSystemDirectoryHandle,
    isWritable: () => true
  });
  await adapter.write('rune-config.yml', 'model:\n  name: Repository model\n', null);
  await adapter.write(
    'build-config.yml',
    'schemaVersion: 1\ntargets:\n  postgres:\n    generator: sql\n    output: generated/pg\n    options:\n      dialect: postgres\n',
    null
  );
  const controller = createProjectController({ workspaceId: 'project', adapter, validateTarget: () => [] });
  return { adapter, controller };
}
describe('file-backed project snapshots', () => {
  it('keeps a valid target usable when another target has an unavailable generator', async () => {
    const { adapter } = await setup();
    const file = (await adapter.read('build-config.yml'))!;
    await adapter.write(
      'build-config.yml',
      file.text + '  custom:\n    generator: custom\n    output: generated/custom\n',
      file.revision
    );
    const controller = createProjectController({
      workspaceId: 'project',
      adapter,
      validateTarget: (target) =>
        target.generator === 'custom'
          ? [{ code: 'TARGET_UNAVAILABLE', severity: 'error', path: 'targets', message: 'Unavailable generator' }]
          : []
    });
    const snapshot = await controller.load();
    expect(snapshot.project.build.targets.postgres?.generator).toBe('sql');
    expect(controller.diagnostics()).toEqual([
      expect.objectContaining({ target: 'custom', code: 'TARGET_UNAVAILABLE' })
    ]);
  });

  it('recovers an interrupted project Save before publishing its completed snapshot', async () => {
    const { controller, adapter } = await setup();
    const initial = await controller.load();
    const write = adapter.write;
    adapter.write = async (path, text, revision) => {
      if (path === 'examples/b.json') throw new Error('disk unavailable');
      return write(path, text, revision);
    };
    await expect(
      controller.save([
        { path: 'examples/a.json', text: '{}', expectedRevision: null },
        { path: 'examples/b.json', text: '{}', expectedRevision: null }
      ])
    ).rejects.toThrow();
    expect(controller.current()).toBe(initial);
    adapter.write = write;
    const recovered = await controller.recover();
    expect(recovered.files.get('examples/b.json')).toBe('{}');
    expect(recovered.revision).not.toBe(initial.revision);
  });

  it('can save a repaired configuration while retaining the last valid execution snapshot', async () => {
    const { controller, adapter } = await setup();
    await controller.load();
    const original = (await adapter.read('build-config.yml'))!;
    const invalidRevision = await adapter.write('build-config.yml', 'targets: [', original.revision);
    await expect(controller.load()).rejects.toThrow();
    const repaired = await controller.save([
      { path: 'build-config.yml', text: original.text, expectedRevision: invalidRevision }
    ]);
    expect(repaired.project.build.targets.postgres?.generator).toBe('sql');
    expect(controller.diagnostics()).toEqual([]);
  });

  it('loads named targets and model identity from repository files', async () => {
    const { controller } = await setup();
    const snapshot = await controller.load();
    expect(snapshot.workspaceId).toBe('project');
    expect(snapshot.project.rune).toEqual({ model: { name: 'Repository model' } });
    expect(Object.keys(snapshot.project.build.targets)).toEqual(['postgres']);
    expect(snapshot.revision).toMatch(/^[a-f0-9]{64}$/);
  });
  it('retains the valid snapshot and reports invalid YAML', async () => {
    const { controller, adapter } = await setup();
    const valid = await controller.load();
    const file = (await adapter.read('build-config.yml'))!;
    await adapter.write('build-config.yml', 'targets: [', file.revision);
    await expect(controller.load()).rejects.toMatchObject({ diagnostics: expect.any(Array) });
    expect(controller.current()).toBe(valid);
    expect(controller.diagnostics().length).toBeGreaterThan(0);
  });
  it('rejects invalid proposed configuration before changing the working copy', async () => {
    const { controller, adapter } = await setup();
    await controller.load();
    const file = (await adapter.read('build-config.yml'))!;
    await expect(
      controller.save([{ path: 'build-config.yml', text: 'schemaVersion: 2', expectedRevision: file.revision }])
    ).rejects.toThrow();
    expect((await adapter.read('build-config.yml'))?.text).toBe(file.text);
  });
  it('rejects a stale save and never publishes a partial snapshot', async () => {
    const { controller, adapter } = await setup();
    const valid = await controller.load();
    const file = (await adapter.read('build-config.yml'))!;
    await adapter.write('build-config.yml', file.text + '# external\n', file.revision);
    await expect(
      controller.save([{ path: 'build-config.yml', text: file.text + '# editor\n', expectedRevision: file.revision }])
    ).rejects.toThrow();
    expect(controller.current()).toBe(valid);
    expect((await adapter.read('build-config.yml'))?.text).toContain('# external');
  });
  it('publishes a new revision only after a successful save/readback', async () => {
    const { controller, adapter } = await setup();
    const previous = await controller.load();
    const saved = await controller.save([{ path: 'examples/a.json', text: '{"a":1}', expectedRevision: null }]);
    expect(saved.revision).not.toBe(previous.revision);
    expect((await adapter.read('examples/a.json'))?.text).toBe(saved.files.get('examples/a.json'));
  });
  it('discards late loads after disposal', async () => {
    const { adapter } = await setup();
    const read = adapter.read;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    adapter.read = async (path) => {
      await gate;
      return read(path);
    };
    const controller = createProjectController({ workspaceId: 'late', adapter, validateTarget: () => [] });
    const result = controller.load();
    controller.dispose();
    release();
    await expect(result).rejects.toThrow(/active/);
    expect(controller.current()).toBeUndefined();
  });
  it('does not publish a torn read when a file changes during activation', async () => {
    const { adapter } = await setup();
    const read = adapter.read;
    let reads = 0;
    adapter.read = async (path) => {
      const file = await read(path);
      if (path === 'build-config.yml' && ++reads === 1)
        await adapter.write(path, file!.text + '# changed\n', file!.revision);
      return file;
    };
    const controller = createProjectController({ workspaceId: 'torn', adapter, validateTarget: () => [] });
    await expect(controller.load()).rejects.toThrow();
    expect(controller.current()).toBeUndefined();
  });
});
