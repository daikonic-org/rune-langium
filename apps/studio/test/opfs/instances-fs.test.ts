// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { describe, expect, it } from 'vitest';
import { OpfsFs } from '../../src/opfs/opfs-fs.js';
import { createOpfsRoot } from '../setup/opfs-mock.js';
import {
  deleteInstance,
  readInstance,
  readInstanceIndex,
  writeInstance,
  writeInstanceIndex
} from '../../src/opfs/instances-fs.js';
import type { InstanceRecord } from '@rune-langium/codegen/instances';

const RECORD: InstanceRecord = {
  id: '01J000000000000000000001',
  name: 'My Party',
  typeFqn: 'test.Party',
  data: { name: 'Acme' },
  createdAt: 1000,
  modifiedAt: 1000
};

describe('instances-fs', () => {
  it('writes and reads an instance record', async () => {
    const fs = new OpfsFs(createOpfsRoot() as never);
    await writeInstance(fs, '/ws1', RECORD);
    const read = await readInstance(fs, '/ws1', RECORD.id);
    expect(read).toEqual(RECORD);
  });

  it('writes and reads the index', async () => {
    const fs = new OpfsFs(createOpfsRoot() as never);
    await writeInstanceIndex(fs, '/ws1', [
      { id: RECORD.id, name: RECORD.name, typeFqn: RECORD.typeFqn, modifiedAt: RECORD.modifiedAt }
    ]);
    const index = await readInstanceIndex(fs, '/ws1');
    expect(index).toHaveLength(1);
    expect(index[0]?.id).toBe(RECORD.id);
  });

  it('returns an empty index when none has been written yet', async () => {
    const fs = new OpfsFs(createOpfsRoot() as never);
    expect(await readInstanceIndex(fs, '/ws1')).toEqual([]);
  });

  it('deletes an instance file', async () => {
    const fs = new OpfsFs(createOpfsRoot() as never);
    await writeInstance(fs, '/ws1', RECORD);
    await deleteInstance(fs, '/ws1', RECORD.id);
    await expect(readInstance(fs, '/ws1', RECORD.id)).rejects.toThrow();
  });
});

it('limits legacy migration to typed instance records and readback-checked private markers', async () => {
  const { createLegacyExampleStorage } = await import('../../src/opfs/instances-fs.js');
  const fs = new OpfsFs(createOpfsRoot() as never);
  const record = {
    id: 'legacy',
    name: 'Trade',
    typeFqn: 'example.Trade',
    data: { amount: 5 },
    createdAt: 1,
    modifiedAt: 2
  };
  await writeInstance(fs, '/migration', record);
  await fs.writeFile('/migration/.studio/token', 'PRIVATE-TOKEN-SENTINEL');
  await fs.writeFile('/migration/.studio/scratch.json', 'PRIVATE-SCRATCH-SENTINEL');
  const source = createLegacyExampleStorage(fs, '/migration', () => true);
  const loaded = await source.load();
  expect(loaded.records).toEqual([record]);
  expect(JSON.stringify(loaded)).not.toContain('PRIVATE-TOKEN-SENTINEL');
  expect(JSON.stringify(loaded)).not.toContain('PRIVATE-SCRATCH-SENTINEL');
  await source.markMigrated('legacy');
  expect((await source.load()).migratedIds.has('legacy')).toBe(true);
  expect(await readInstance(fs, '/migration', 'legacy')).toEqual(record);
});

it('does not mark a legacy record migrated after its inspected bytes change or ownership is lost', async () => {
  const { createLegacyExampleStorage } = await import('../../src/opfs/instances-fs.js');
  const fs = new OpfsFs(createOpfsRoot() as never);
  const record = {
    id: 'legacy',
    name: 'Trade',
    typeFqn: 'example.Trade',
    data: { amount: 5 },
    createdAt: 1,
    modifiedAt: 2
  };
  await writeInstance(fs, '/migration-conflict', record);
  let writable = true;
  const source = createLegacyExampleStorage(fs, '/migration-conflict', () => writable);
  await source.load();
  await writeInstance(fs, '/migration-conflict', { ...record, data: { amount: 6 } });
  await expect(source.markMigrated('legacy')).rejects.toThrow();
  expect((await source.load()).migratedIds.size).toBe(0);
  writable = false;
  await expect(source.markMigrated('legacy')).rejects.toThrow();
  expect((await source.load()).migratedIds.size).toBe(0);
  expect((await readInstance(fs, '/migration-conflict', 'legacy')).data).toEqual({ amount: 6 });
});
