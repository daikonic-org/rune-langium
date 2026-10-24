// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { expect, it, vi } from 'vitest';
import { readExamples, type ExampleDescriptor } from '@rune-langium/project-config';
import { createOpfsRoot } from '../setup/opfs-mock.js';
import { createProjectFileAdapter } from '../../src/workspace/project-file-adapter.js';
import { createProjectController } from '../../src/workspace/project-controller.js';
import { saveExample, removeExample, migrateLegacyExamples } from '../../src/workspace/example-repository.js';
const type = { model: 'local', namespace: 'example', kind: 'Data', name: 'Trade' };
const example = (id: string): ExampleDescriptor => ({
  schemaVersion: 1,
  id,
  name: 'Trade ' + id,
  type,
  payload: 'examples/' + id + '.json',
  codec: 'JSON'
});
async function setup() {
  const adapter = createProjectFileAdapter({
    workspaceId: 'examples',
    root: createOpfsRoot() as unknown as FileSystemDirectoryHandle,
    privateRoot: createOpfsRoot() as unknown as FileSystemDirectoryHandle,
    isWritable: () => true
  });
  await adapter.write('rune-config.yml', 'model: {name: Example}\n', null);
  const controller = createProjectController({ workspaceId: 'examples', adapter, validateTarget: () => [] });
  await controller.load();
  return { adapter, controller };
}
it('saves stable IDs, full type identities and exact data through repository files across a clone', async () => {
  const { controller } = await setup();
  await saveExample(controller, example('one'), { amount: 10.123456789 });
  await saveExample(controller, example('two'), { amount: 20 });
  const clone = await setup();
  for (const [path, text] of controller.current()!.files) {
    const current = await clone.adapter.read(path);
    await clone.adapter.write(path, text, current?.revision ?? null);
  }
  const read = readExamples(await clone.controller.load());
  expect(read.examples.map((entry) => entry.id)).toEqual(['one', 'two']);
  expect(read.examples[0]?.type).toEqual(type);
  expect(read.documents.map((entry) => entry.payload)).toEqual([{ amount: 10.123456789 }, { amount: 20 }]);
});
it('refuses descriptor codec mismatch and unavailable Rune default serialization without writing a false JSON success', async () => {
  const { adapter, controller } = await setup();
  const before = await adapter.list();
  await expect(saveExample(controller, { ...example('bad'), codec: 'XML' }, {})).rejects.toThrow(/codec|format/i);
  expect(await adapter.list()).toEqual(before);
  const config = (await adapter.read('rune-config.yml'))!;
  await adapter.write('rune-config.yml', 'model: {name: Example, defaultSerialisationFormat: XML}\n', config.revision);
  await controller.load();
  await expect(saveExample(controller, example('default'), {})).rejects.toThrow(/codec|format/i);
  expect((await adapter.list()).some((path) => path.startsWith('examples/'))).toBe(false);
});
it('removes only one example descriptor and its owned payload using shared Save', async () => {
  const { adapter, controller } = await setup();
  await saveExample(controller, example('one'), { amount: 1 });
  await saveExample(controller, example('two'), { amount: 2 });
  await removeExample(controller, 'one');
  const read = readExamples(controller.current()!);
  expect(read.examples.map((entry) => entry.id)).toEqual(['two']);
  expect(await adapter.read('examples/one.json')).toBeUndefined();
  expect((await adapter.read('examples/two.json'))?.text).toContain('2');
  expect(await adapter.read('rune-config.yml')).toBeDefined();
});
it('does not overwrite an unmanaged existing file when claiming a new payload path', async () => {
  const { adapter, controller } = await setup();
  await adapter.write('examples/one.json', 'existing user data', null);
  await controller.load();
  await expect(saveExample(controller, example('one'), { amount: 1 })).rejects.toThrow();
  expect((await adapter.read('examples/one.json'))?.text).toBe('existing user data');
});
it('migrates typed legacy records by exact ID only after readback and is idempotent', async () => {
  const { controller } = await setup();
  const records = [
    { id: 'legacy', name: 'Old trade', typeFqn: 'example.Trade', data: { amount: 8 }, createdAt: 1, modifiedAt: 2 }
  ];
  const migrated = new Set<string>();
  const markMigrated = vi.fn(async (id: string) => {
    expect(readExamples(controller.current()!).documents[0]?.payload).toEqual(records[0]!.data);
    migrated.add(id);
  });
  const options = { resolveType: () => type, migratedIds: migrated, markMigrated };
  expect((await migrateLegacyExamples(controller, records, options)).diagnostics).toEqual([]);
  expect(readExamples(controller.current()!).examples[0]?.id).toBe('legacy');
  expect(records[0]?.data).toEqual({ amount: 8 });
  await migrateLegacyExamples(controller, records, options);
  expect(markMigrated).toHaveBeenCalledOnce();
});
it('retains a failed legacy conversion and does not mark it migrated before recovery readback', async () => {
  const { adapter, controller } = await setup();
  const records = [
    { id: 'legacy', name: 'Old trade', typeFqn: 'example.Trade', data: { amount: 8 }, createdAt: 1, modifiedAt: 2 }
  ];
  const write = adapter.write;
  adapter.write = async (path, text, revision) => {
    if (path.startsWith('examples/')) throw new Error('disk unavailable');
    return write(path, text, revision);
  };
  const markMigrated = vi.fn().mockResolvedValue(undefined);
  const result = await migrateLegacyExamples(controller, records, { resolveType: () => type, markMigrated });
  expect(result.diagnostics.length).toBeGreaterThan(0);
  expect(markMigrated).not.toHaveBeenCalled();
  expect(records[0]?.data).toEqual({ amount: 8 });
  adapter.write = write;
  await controller.recover();
  const retried = await migrateLegacyExamples(controller, records, { resolveType: () => type, markMigrated });
  expect(retried.diagnostics).toEqual([]);
  expect(markMigrated).toHaveBeenCalledWith('legacy');
});
it('keeps unresolved legacy type bindings without inventing an owner or discarding data', async () => {
  const { controller } = await setup();
  const records = [
    { id: 'legacy', name: 'Unknown trade', typeFqn: 'missing.Trade', data: { amount: 8 }, createdAt: 1, modifiedAt: 2 }
  ];
  const markMigrated = vi.fn();
  const result = await migrateLegacyExamples(controller, records, { resolveType: () => undefined, markMigrated });
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'EXAMPLE_TYPE_UNAVAILABLE' }));
  expect(markMigrated).not.toHaveBeenCalled();
  expect(readExamples(controller.current()!).examples).toEqual([]);
  expect(records[0]?.data).toEqual({ amount: 8 });
});

it('adapts repository examples to the existing store, serializing saves and retaining missing bindings', async () => {
  const { createExampleRepository } = await import('../../src/workspace/example-repository.js');
  const { controller } = await setup();
  const repository = createExampleRepository({
    workspaceId: 'examples',
    controller,
    resolveType: (record) => (record.typeFqn === 'example.Trade' ? type : undefined)
  });
  const record = {
    id: 'one',
    name: 'Trade one',
    typeFqn: 'example.Trade',
    typeIdentity: type,
    data: { amount: 9.876 },
    createdAt: 1,
    modifiedAt: 2
  };
  await Promise.all([repository.write(record), repository.write({ ...record, id: 'two', name: 'Trade two' })]);
  expect((await repository.load()).records.map((entry) => entry.id)).toEqual(['one', 'two']);
  const reopened = createExampleRepository({ workspaceId: 'examples', controller, resolveType: () => undefined });
  const read = await reopened.load();
  expect(read.records[0]?.data).toEqual(record.data);
  expect(read.records[0]?.typeIdentity).toEqual(type);
  expect(read.diagnostics.some((entry) => entry.code === 'EXAMPLE_TYPE_UNAVAILABLE')).toBe(true);
  await reopened.remove('one');
  expect((await reopened.load()).records.map((entry) => entry.id)).toEqual(['two']);
});

it('recovers an interrupted example Save on retry and reopen through the same controller', async () => {
  const { createExampleRepository } = await import('../../src/workspace/example-repository.js');
  const { adapter, controller } = await setup();
  const repository = createExampleRepository({ workspaceId: 'examples', controller, resolveType: () => type });
  const write = adapter.write;
  let fail = true;
  adapter.write = async (path, text, revision) => {
    if (fail && path.startsWith('examples/')) throw new Error('disk full');
    return write(path, text, revision);
  };
  const record = {
    id: 'recover',
    name: 'Recover',
    typeFqn: 'example.Trade',
    data: { amount: 4 },
    createdAt: 0,
    modifiedAt: 0
  };
  await expect(repository.write(record)).rejects.toThrow();
  fail = false;
  await repository.write(record);
  expect((await repository.load()).records[0]?.data).toEqual(record.data);
  fail = true;
  await expect(repository.write({ ...record, data: { amount: 5 } })).rejects.toThrow();
  fail = false;
  const reopened = createProjectController({ workspaceId: 'examples', adapter, validateTarget: () => [] });
  await expect(reopened.load()).rejects.toThrow();
  const restored = createExampleRepository({ workspaceId: 'examples', controller: reopened, resolveType: () => type });
  expect((await restored.load()).records[0]?.data).toEqual({ amount: 5 });
});

it('keeps portable examples visible when private legacy storage is unavailable', async () => {
  const { createExampleRepository } = await import('../../src/workspace/example-repository.js');
  const { controller } = await setup();
  await saveExample(controller, example('portable'), { amount: 2 });
  const repository = createExampleRepository({
    workspaceId: 'examples',
    controller,
    resolveType: () => type,
    legacy: {
      load: async () => {
        throw new Error('private marker unreadable');
      },
      markMigrated: vi.fn()
    }
  });
  const restored = await repository.load();
  expect(restored.records.map((record) => record.id)).toEqual(['portable']);
  expect(restored.diagnostics.some((issue) => issue.code === 'LEGACY_EXAMPLES_UNAVAILABLE')).toBe(true);
});

it.each(['malformed', 'missing'])(
  'refuses semantic writes and retries of an undecoded %s example without changing its payload',
  async (problem) => {
    const { createExampleRepository } = await import('../../src/workspace/example-repository.js');
    const { adapter, controller } = await setup();
    await saveExample(controller, example('broken'), { amount: 12 });
    const path = 'examples/broken.json';
    const previous = (await adapter.read(path))!;
    if (problem === 'malformed') await adapter.write(path, '{"amount": 12, BROKEN', previous.revision);
    else await adapter.remove(path, previous.revision);
    await controller.load();
    const repository = createExampleRepository({ workspaceId: 'examples', controller, resolveType: () => type });
    const loaded = await repository.load();
    const record = loaded.records[0]!;
    expect(loaded.failures?.broken).toMatch(/payload|repair|restore/i);
    const before = (await adapter.read(path))?.text;
    await expect(repository.write({ ...record, name: 'Renamed' })).rejects.toThrow(/payload|repair|restore/i);
    await expect(repository.write(record)).rejects.toThrow(/payload|repair|restore/i);
    expect((await adapter.read(path))?.text).toBe(before);
    expect(readExamples(controller.current()!).examples[0]!.name).toBe('Trade broken');
    if (problem === 'missing') await adapter.write(path, '{"amount": 13}', null);
    else await adapter.write(path, '{"amount": 13}', (await adapter.read(path))!.revision);
    await controller.load();
    const repaired = await repository.load();
    expect(repaired.failures?.broken).toBeUndefined();
    await repository.write({ ...repaired.records[0]!, name: 'Repaired' });
    expect(readExamples(controller.current()!).documents[0]!.payload).toEqual({ amount: 13 });
  }
);
