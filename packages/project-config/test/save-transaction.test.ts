// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { describe, expect, it } from 'vitest';
import { ProjectFileConflict, type ProjectFileAdapter, type ProjectWrite } from '../src/project-files.js';
import { saveProject, recoverProjectSave } from '../src/save-transaction.js';

class MemoryFiles implements ProjectFileAdapter {
  files = new Map<string, { text: string; revision: string }>();
  failOn: string | undefined;
  counter = 0;
  seed(path: string, text: string) {
    this.files.set(path, { text, revision: String(++this.counter) });
  }
  async read(path: string) {
    const file = this.files.get(path);
    return file ? { ...file } : undefined;
  }
  async write(path: string, text: string, expectedRevision: string | null) {
    if (path === this.failOn) throw Error('disk unavailable');
    if ((this.files.get(path)?.revision ?? null) !== expectedRevision) throw new ProjectFileConflict(path);
    this.seed(path, text);
    return this.files.get(path)!.revision;
  }
  async remove(path: string, revision: string) {
    if (this.files.get(path)?.revision !== revision) throw new ProjectFileConflict(path);
    this.files.delete(path);
  }
  async list() {
    return [...this.files.keys()].filter((p) => !p.startsWith('.studio/'));
  }
}
const setup = () => {
  const adapter = new MemoryFiles();
  for (const name of ['a', 'b', 'c']) adapter.seed(name, `old-${name}`);
  return {
    adapter,
    writes: ['a', 'b', 'c'].map((path) => ({
      path,
      text: `new-${path}`,
      expectedRevision: adapter.files.get(path)!.revision
    }))
  };
};

describe('recoverable project Save', () => {
  it('publishes success only after every file is read back', async () => {
    const { adapter, writes } = setup();
    expect((await saveProject(adapter, writes, 'save-1')).status).toBe('saved');
    expect((await adapter.read('a'))?.text).toBe('new-a');
    expect((await adapter.read('b'))?.text).toBe('new-b');
    expect((await adapter.read('c'))?.text).toBe('new-c');
    expect([...adapter.files.keys()]).toEqual(['a', 'b', 'c']);
  });
  it('does not replace a newer file when preparation detects a conflict', async () => {
    const { adapter, writes } = setup();
    adapter.seed('b', 'someone else');
    expect((await saveProject(adapter, writes, 'save-2')).status).toBe('conflict');
    expect((await adapter.read('a'))?.text).toBe('old-a');
    expect((await adapter.read('b'))?.text).toBe('someone else');
  });
  it('recovers an interrupted write from a reopened adapter', async () => {
    const { adapter, writes } = setup();
    adapter.failOn = 'b';
    expect((await saveProject(adapter, writes, 'save-3')).status).toBe('recoverable');
    expect((await adapter.read('a'))?.text).toBe('new-a');
    expect((await adapter.read('b'))?.text).toBe('old-b');
    const reopened = new MemoryFiles();
    reopened.files = adapter.files;
    reopened.counter = adapter.counter;
    expect(await recoverProjectSave(reopened)).toEqual([]);
    expect((await reopened.read('c'))?.text).toBe('new-c');
    expect([...reopened.files.keys()]).toEqual(['a', 'b', 'c']);
  });
  it('preserves a third-party edit instead of completing over it during recovery', async () => {
    const { adapter, writes } = setup();
    adapter.failOn = 'b';
    await saveProject(adapter, writes, 'save-4');
    adapter.failOn = undefined;
    adapter.seed('b', 'external edit');
    expect((await recoverProjectSave(adapter)).some((d) => d.code === 'SAVE_CONFLICT')).toBe(true);
    expect((await adapter.read('b'))?.text).toBe('external edit');
    expect((await adapter.read('c'))?.text).toBe('old-c');
  });
  it('does not claim success if an applied file changes before readback', async () => {
    const { adapter, writes } = setup();
    const remove = adapter.remove.bind(adapter);
    adapter.remove = async (path, revision) => {
      adapter.seed('a', 'newer external');
      await remove(path, revision);
    };
    const result = await saveProject(adapter, writes, 'readback');
    expect(result.status).not.toBe('saved');
    expect((await adapter.read('a'))?.text).toBe('newer external');
  });
  it('can retry an already completed write without changing its files', async () => {
    const { adapter, writes } = setup();
    await saveProject(adapter, writes, 'same-operation');
    const revision = (await adapter.read('a'))!.revision;
    expect((await saveProject(adapter, writes, 'same-operation')).status).toBe('saved');
    expect((await adapter.read('a'))!.revision).toBe(revision);
  });
  it('does not replay a peer operation when a new Save sees its journal', async () => {
    const { adapter, writes } = setup();
    adapter.failOn = 'b';
    await saveProject(adapter, writes, 'unfinished');
    adapter.failOn = undefined;
    expect(
      (await saveProject(adapter, [{ path: 'other', text: 'no', expectedRevision: null }], 'another')).status
    ).toBe('conflict');
    expect(await adapter.read('other')).toBeUndefined();
    expect((await adapter.read('b'))?.text).toBe('old-b');
  });
  it.each(['../token', '.git/config', '.studio/token', '/private', 'C:\\private'])(
    'refuses unsafe managed write %s',
    async (path) => {
      const adapter = new MemoryFiles();
      const result = await saveProject(adapter, [{ path, text: 'data', expectedRevision: null }], 'unsafe');
      expect(result.status).not.toBe('saved');
      expect(adapter.files.size).toBe(0);
    }
  );
  it('rejects duplicate destinations before writing any data', async () => {
    const adapter = new MemoryFiles();
    const writes: ProjectWrite[] = [
      { path: 'a', text: 'one', expectedRevision: null },
      { path: './a', text: 'two', expectedRevision: null }
    ];
    expect((await saveProject(adapter, writes, 'duplicates')).status).toBe('conflict');
    expect(adapter.files.size).toBe(0);
  });
  it('reports permission failures and leaves a retryable journal', async () => {
    const { adapter, writes } = setup();
    adapter.failOn = 'a';
    expect((await saveProject(adapter, writes, 'permission')).status).toBe('recoverable');
    expect((await adapter.read('a'))?.text).toBe('old-a');
    adapter.failOn = undefined;
    expect(await recoverProjectSave(adapter)).toEqual([]);
  });
});

describe('journal validation', () => {
  it('preserves files when a malformed recovery journal requests a private path', async () => {
    const adapter = new MemoryFiles();
    adapter.seed(
      '.studio/project-save/journal.json',
      JSON.stringify({
        schemaVersion: 1,
        operationId: 'invalid',
        writes: [{ path: '.git/config', text: 'no', expectedRevision: null }]
      })
    );
    expect(await recoverProjectSave(adapter)).not.toEqual([]);
    expect(await adapter.read('.git/config')).toBeUndefined();
  });
  it('rejects an unsupported journal without touching the working copy', async () => {
    const adapter = new MemoryFiles();
    adapter.seed('.studio/project-save/journal.json', '{"schemaVersion":2}');
    expect(await recoverProjectSave(adapter)).not.toEqual([]);
    expect(adapter.files.size).toBe(1);
  });
});

describe('reviewed Save input preconditions', () => {
  const preview = () => {
    const adapter = new MemoryFiles();
    adapter.seed('pom.xml', '<project/>');
    const conditions = {
      inputs: [{ path: 'pom.xml', revision: adapter.files.get('pom.xml')!.revision }],
      paths: ['pom.xml']
    };
    const writes = [
      { path: 'build-config.yml', text: 'schemaVersion: 1', expectedRevision: null },
      { path: 'build-config.import.json', text: '{}', expectedRevision: null }
    ];
    return { adapter, conditions, writes };
  };
  it('rejects a stale inspected POM without writing settings or a journal', async () => {
    const { adapter, conditions, writes } = preview();
    adapter.seed('pom.xml', '<project>newer</project>');
    expect((await saveProject(adapter, writes, 'stale-preview', conditions)).status).toBe('conflict');
    expect([...adapter.files.keys()]).toEqual(['pom.xml']);
    expect((await adapter.read('pom.xml'))?.text).toContain('newer');
  });
  it('rejects a changed repository file list before preparing the operation', async () => {
    const { adapter, conditions, writes } = preview();
    adapter.seed('build-config.yaml', 'schemaVersion: 1');
    expect((await saveProject(adapter, writes, 'new-companion', conditions)).status).toBe('conflict');
    expect(await adapter.read('build-config.yml')).toBeUndefined();
  });
  it('saves proposed files without ever writing the inspected inputs', async () => {
    const { adapter, conditions, writes } = preview();
    const original = await adapter.read('pom.xml');
    const write = adapter.write.bind(adapter);
    adapter.write = async (path, text, revision) => {
      expect(path).not.toBe('pom.xml');
      return write(path, text, revision);
    };
    expect((await saveProject(adapter, writes, 'reviewed', conditions)).status).toBe('saved');
    expect(await adapter.read('pom.xml')).toEqual(original);
  });
  it('retains read-only input conditions across interrupted Save and recovery', async () => {
    const { adapter, conditions, writes } = preview();
    adapter.failOn = 'build-config.import.json';
    expect((await saveProject(adapter, writes, 'partial-preview', conditions)).status).toBe('recoverable');
    adapter.failOn = undefined;
    adapter.seed('pom.xml', 'external edit');
    expect(await recoverProjectSave(adapter)).toEqual([
      expect.objectContaining({ code: 'SAVE_CONFLICT', path: 'pom.xml' })
    ]);
    expect(await adapter.read('build-config.import.json')).toBeUndefined();
    expect((await adapter.read('pom.xml'))?.text).toBe('external edit');
    expect(await adapter.read('.studio/project-save/journal.json')).toBeDefined();
  });
  it('recovers the reviewed operation when its source is still current', async () => {
    const { adapter, conditions, writes } = preview();
    adapter.failOn = 'build-config.import.json';
    await saveProject(adapter, writes, 'recover-preview', conditions);
    adapter.failOn = undefined;
    expect(await recoverProjectSave(adapter)).toEqual([]);
    expect((await adapter.read('build-config.import.json'))?.text).toBe('{}');
  });
  it('detects input changes during write readback', async () => {
    const { adapter, conditions, writes } = preview();
    const remove = adapter.remove.bind(adapter);
    adapter.remove = async (path, revision) => {
      await remove(path, revision);
      adapter.seed('pom.xml', 'concurrent change');
    };
    expect((await saveProject(adapter, writes, 'readback-input', conditions)).status).toBe('conflict');
  });
  it.each(['../pom.xml', '.git/config', '.studio/token'])('rejects unsafe input condition %s', async (path) => {
    const { adapter, writes } = preview();
    expect((await saveProject(adapter, writes, 'unsafe-input', { inputs: [{ path, revision: null }] })).status).toBe(
      'conflict'
    );
    expect(await adapter.read('build-config.yml')).toBeUndefined();
  });
  it('rejects read/write overlap and case-aliased conditions', async () => {
    for (const inputs of [
      [{ path: 'build-config.yml', revision: null }],
      [
        { path: 'pom.xml', revision: '1' },
        { path: 'POM.xml', revision: '1' }
      ]
    ]) {
      const { adapter, writes } = preview();
      expect((await saveProject(adapter, writes, 'alias-input', { inputs })).status).toBe('conflict');
      expect(await adapter.read('build-config.yml')).toBeUndefined();
    }
  });
});

describe('shared recoverable Save removals', () => {
  it('saves a descriptor replacement and removes only the explicitly owned payload', async () => {
    const { adapter, writes } = setup();
    const result = await saveProject(
      adapter,
      [{ path: 'a', remove: true, expectedRevision: adapter.files.get('a')!.revision }, writes[1]!],
      'remove-and-write'
    );
    expect(result.status).toBe('saved');
    expect(await adapter.read('a')).toBeUndefined();
    expect((await adapter.read('b'))?.text).toBe('new-b');
    expect((await adapter.read('c'))?.text).toBe('old-c');
  });
  it('checks every removal revision before changing any file', async () => {
    const { adapter } = setup();
    const first = (await adapter.read('a'))!;
    const second = (await adapter.read('b'))!;
    adapter.seed('b', 'external edit');
    expect(
      (
        await saveProject(
          adapter,
          [
            { path: 'a', remove: true, expectedRevision: first.revision },
            { path: 'b', remove: true, expectedRevision: second.revision }
          ],
          'stale-remove'
        )
      ).status
    ).toBe('conflict');
    expect(await adapter.read('a')).toEqual(first);
    expect((await adapter.read('b'))?.text).toBe('external edit');
  });
  it('recovers after removal but refuses to remove a newer file recreated at that path', async () => {
    for (const external of [false, true]) {
      const { adapter, writes } = setup();
      adapter.failOn = 'b';
      expect(
        (
          await saveProject(
            adapter,
            [{ path: 'a', remove: true, expectedRevision: adapter.files.get('a')!.revision }, writes[1]!],
            'partial-remove'
          )
        ).status
      ).toBe('recoverable');
      expect(await adapter.read('a')).toBeUndefined();
      adapter.failOn = undefined;
      if (external) adapter.seed('a', 'new owner');
      const diagnostics = await recoverProjectSave(adapter);
      if (external) {
        expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'SAVE_CONFLICT' }));
        expect((await adapter.read('a'))?.text).toBe('new owner');
        expect((await adapter.read('b'))?.text).toBe('old-b');
      } else {
        expect(diagnostics).toEqual([]);
        expect((await adapter.read('b'))?.text).toBe('new-b');
      }
    }
  });
  it('verifies removed-file absence after final readback', async () => {
    const { adapter } = setup();
    const remove = adapter.remove.bind(adapter);
    adapter.remove = async (path, revision) => {
      await remove(path, revision);
      if (path.startsWith('.studio/')) adapter.seed('a', 'new writer');
    };
    expect(
      (
        await saveProject(
          adapter,
          [{ path: 'a', remove: true, expectedRevision: adapter.files.get('a')!.revision }],
          'remove-readback'
        )
      ).status
    ).toBe('conflict');
    expect((await adapter.read('a'))?.text).toBe('new writer');
  });
  it('retains read-only input and file-list preconditions during a removal', async () => {
    const { adapter } = setup();
    const revision = adapter.files.get('c')!.revision;
    expect(
      (
        await saveProject(
          adapter,
          [{ path: 'a', remove: true, expectedRevision: adapter.files.get('a')!.revision }],
          'reviewed-remove',
          { paths: ['a', 'b', 'c'], inputs: [{ path: 'c', revision }] }
        )
      ).status
    ).toBe('saved');
    expect(await adapter.read('a')).toBeUndefined();
    expect((await adapter.read('c'))?.revision).toBe(revision);
  });
});
