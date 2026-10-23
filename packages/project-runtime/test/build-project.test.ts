// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuneDslServices } from '@rune-langium/core';
import { generate } from '@rune-langium/codegen/export';
import { URI } from 'langium';
import { projectBytesRevision } from '@rune-langium/project-config';
import { buildProject } from '../src/build-project.js';
import { openLocalProject } from '../src/local-project.js';
import { createNodeProjectFileAdapter } from '../src/node-files.js';

const temp: string[] = [];
afterEach(async () => {
  await Promise.all(temp.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
const source = 'namespace example\ntype Trade:\n  amount number (1..1)\n';
const targets = {
  pg: { generator: 'sql', output: 'generated/pg', options: { dialect: 'postgres' } },
  ss: { generator: 'sql', output: 'generated/ss', options: { dialect: 'sqlserver' } }
} as const;
async function setup(build: Record<string, unknown> = { targets }, model = source) {
  const parent = await mkdtemp(join(tmpdir(), 'rune-build-'));
  temp.push(parent);
  const root = join(parent, 'project');
  await mkdir(join(root, 'model'), { recursive: true });
  await writeFile(join(root, 'rune-config.yml'), 'model: {name: Example}\n');
  await writeFile(join(root, 'build-config.yml'), JSON.stringify({ schemaVersion: 1, ...build }));
  await writeFile(join(root, 'model', 'trade.rosetta'), model);
  return { root, parent, ...(await openLocalProject(root, { privateRoot: join(parent, 'private') })) };
}
describe('explicit project builds', () => {
  it('writes non-UTF8 output bytes without a text conversion', async () => {
    const { root, adapter } = await setup();
    const bytes = Uint8Array.from([0x50, 0x4b, 0xff, 0xc0, 0, 0xfe]);
    const revision = await adapter.writeBinary!('generated/exact.bin', bytes, null);
    expect([...(await readFile(join(root, 'generated', 'exact.bin')))]).toEqual([...bytes]);
    expect(revision).toBe(await projectBytesRevision(bytes));
    expect((await adapter.read('generated/exact.bin'))?.revision).toBe(revision);
  });
  it('reports a binary-backing capability failure before writing output', async () => {
    const { root, snapshot, adapter } = await setup({
      targets: { workbook: { generator: 'excel', output: 'generated/excel' } }
    });
    adapter.writeBinary = undefined;
    const result = await buildProject(snapshot, { targets: ['workbook'] }, adapter);
    expect(result.status).toBe('failed');
    expect(result.diagnostics.some((issue) => issue.code === 'BINARY_OUTPUT_UNAVAILABLE')).toBe(true);
    expect(await readdir(root)).not.toContain('generated');
  });

  it('expands upstream Rune namespace defaults and allows a target to override them', async () => {
    const { root, parent } = await setup({
      targets: { pg: targets.pg, other: { ...targets.pg, output: 'generated/other', namespaces: ['other'] } }
    });
    await writeFile(
      join(root, 'rune-config.yml'),
      'model: {name: Example}\ngenerators:\n  namespaces: [example.*, com.rosetta.model]\n'
    );
    await writeFile(join(root, 'model', 'other.rosetta'), 'namespace other\ntype Other:\n  value string (1..1)\n');
    const { snapshot, adapter } = await openLocalProject(root, { privateRoot: join(parent, 'private') });
    const first = await buildProject(snapshot, { targets: ['pg'] }, adapter);
    expect(first.status).toBe('success');
    const firstText = (await Promise.all(first.outputs.map((path) => readFile(join(root, path), 'utf8')))).join('\n');
    expect(firstText).toContain('Trade');
    expect(firstText).not.toContain('Other');
    const reopened = await openLocalProject(root, { privateRoot: join(parent, 'private') });
    const second = await buildProject(reopened.snapshot, { targets: ['other'] }, reopened.adapter);
    expect(second.status).toBe('success');
    const secondText = (await Promise.all(second.outputs.map((path) => readFile(join(root, path), 'utf8')))).join('\n');
    expect(secondText).toContain('Other');
    expect(secondText).not.toContain('Trade');
  });

  it('refuses a write through an internal symlink that aliases a source directory', async () => {
    const { root, parent } = await setup();
    await symlink(join(root, 'model'), join(root, 'alias'), 'dir');
    const adapter = await createNodeProjectFileAdapter(root, { privateRoot: join(parent, 'private') });
    await expect(adapter.write('alias/generated.sql', 'not source', null)).rejects.toThrow(/symlink/i);
    expect(await readdir(join(root, 'model'))).toEqual(['trade.rosetta']);
  });

  it('blocks both targets involved in overlapping output directories', async () => {
    const { root, snapshot, adapter } = await setup({
      targets: {
        a: { generator: 'sql', output: 'generated/sql' },
        b: { generator: 'sql', output: 'generated/sql/nested' }
      }
    });
    const result = await buildProject(snapshot, { targets: ['a'] }, adapter);
    expect(result.status).toBe('failed');
    expect(result.diagnostics.some((issue) => issue.code === 'OUTPUT_COLLISION' && issue.target === 'a')).toBe(true);
    expect(await readdir(root)).not.toContain('generated');
  });
  it('protects actual source paths when source globs start at the project root', async () => {
    const { root, snapshot, adapter } = await setup({
      sources: ['**/*.rosetta'],
      targets: { a: { generator: 'sql', output: 'model' } }
    });
    const result = await buildProject(snapshot, { targets: ['a'] }, adapter);
    expect(result.status).toBe('failed');
    expect(await readFile(join(root, 'model', 'trade.rosetta'), 'utf8')).toBe(source);
    expect(await readdir(join(root, 'model'))).toEqual(['trade.rosetta']);
  });

  it('preserves generated Excel bytes as a binary workbook', async () => {
    const { root, snapshot, adapter } = await setup({
      targets: { workbook: { generator: 'excel', output: 'generated/excel' } }
    });
    const result = await buildProject(snapshot, { targets: ['workbook'] }, adapter);
    expect(result.status).toBe('success');
    const path = result.outputs.find((path) => path.endsWith('.xlsx'))!;
    expect(path).toBeDefined();
    const bytes = await readFile(join(root, path));
    expect([...bytes.subarray(0, 2)]).toEqual([0x50, 0x4b]);
  });

  it('requires a nonempty explicit target selection and writes nothing otherwise', async () => {
    const { root, snapshot, adapter } = await setup();
    expect((await buildProject(snapshot, { targets: [] }, adapter)).status).toBe('failed');
    expect(await readdir(root)).not.toContain('generated');
  });
  it('rejects an unknown target without creating an output directory', async () => {
    const { root, snapshot, adapter } = await setup();
    const result = await buildProject(snapshot, { targets: ['unknown'] }, adapter);
    expect(result.status).toBe('failed');
    expect(result.diagnostics.some((issue) => issue.code === 'TARGET_UNKNOWN')).toBe(true);
    expect(await readdir(root)).not.toContain('generated');
  });
  it('diagnoses an unavailable generator without falling back or blocking a valid target', async () => {
    const { root, snapshot, adapter } = await setup({
      targets: { ...targets, unsupported: { generator: 'scala', output: 'generated/scala' } }
    });
    expect((await buildProject(snapshot, { targets: ['unsupported'] }, adapter)).status).toBe('failed');
    expect(await readdir(root)).not.toContain('generated');
    expect((await buildProject(snapshot, { targets: ['pg'] }, adapter)).status).toBe('success');
  });
  it('builds two named SQL targets separately with direct-codegen byte parity', async () => {
    const { root, snapshot, adapter } = await setup();
    const result = await buildProject(snapshot, { targets: 'all' }, adapter);
    expect(result.status).toBe('success');
    expect(result.outputs.length).toBeGreaterThanOrEqual(2);
    const { RuneDsl } = createRuneDslServices();
    await RuneDsl.shared.workspace.WorkspaceManager.initializeWorkspace([]);
    const doc = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
      source,
      URI.parse('inmemory:///direct.rosetta')
    );
    await RuneDsl.shared.workspace.DocumentBuilder.build([doc]);
    for (const name of ['pg', 'ss'] as const) {
      const output = await generate(doc, { target: 'sql', strict: true, sql: targets[name].options });
      for (const file of output)
        expect(await readFile(join(root, targets[name].output, file.relativePath), 'utf8')).toBe(file.content);
    }
    const pg = await Promise.all(
      result.outputs
        .filter((path) => path.startsWith('generated/pg/'))
        .map((path) => readFile(join(root, path), 'utf8'))
    );
    const ss = await Promise.all(
      result.outputs
        .filter((path) => path.startsWith('generated/ss/'))
        .map((path) => readFile(join(root, path), 'utf8'))
    );
    expect(pg.join('')).not.toBe(ss.join(''));
    expect(await readFile(join(root, 'model', 'trade.rosetta'), 'utf8')).toBe(source);
  });
  it('links multiple source files in one graph', async () => {
    const { root } = await setup(
      { targets: { ts: { generator: 'typescript', output: 'generated/ts' } } },
      'namespace example\nimport dependencies.*\ntype Trade:\n  money Money (1..1)\n'
    );
    await writeFile(
      join(root, 'model', 'money.rosetta'),
      'namespace dependencies\ntype Money:\n  amount number (1..1)\n'
    );
    const { snapshot, adapter } = await openLocalProject(root, { privateRoot: join(root, '..', 'private') });
    const result = await buildProject(snapshot, { targets: ['ts'] }, adapter);
    expect(result.status).toBe('success');
    const content = (await Promise.all(result.outputs.map((path) => readFile(join(root, path), 'utf8')))).join('\n');
    expect(content).toContain('Money');
    expect(content).toContain('Trade');
  });
  it('rejects output symlinks that escape the project', async () => {
    const { root, parent, snapshot, adapter } = await setup();
    const outside = join(parent, 'outside');
    await mkdir(outside);
    await symlink(outside, join(root, 'generated'), 'dir');
    expect((await buildProject(snapshot, { targets: ['pg'] }, adapter)).status).toBe('failed');
    expect(await readdir(outside)).toEqual([]);
  });
  it('fails unresolved reference requests before writing output', async () => {
    const { root, snapshot, adapter } = await setup({
      targets,
      references: { cdm: { repository: 'finos/common-domain-model', release: 'v1' } }
    });
    const result = await buildProject(snapshot, { targets: ['pg'] }, adapter);
    expect(result.status).toBe('failed');
    expect(result.diagnostics.some((issue) => issue.code === 'REFERENCE_UNRESOLVED')).toBe(true);
    expect(await readdir(root)).not.toContain('generated');
  });
  it('refuses invalid linked sources before any target output is written', async () => {
    const { root, snapshot, adapter } = await setup(
      { targets },
      'namespace example\ntype Trade:\n  missing MissingType (1..1)\n'
    );
    expect((await buildProject(snapshot, { targets: 'all' }, adapter)).status).toBe('failed');
    expect(await readdir(root)).not.toContain('generated');
  });
  it('does not build from a snapshot after its input file changed', async () => {
    const { root, snapshot, adapter } = await setup();
    await writeFile(join(root, 'model', 'trade.rosetta'), source + '# external\n');
    const result = await buildProject(snapshot, { targets: ['pg'] }, adapter);
    expect(result.status).toBe('failed');
    expect(result.diagnostics.some((issue) => issue.code === 'PROJECT_STALE')).toBe(true);
    expect(await readdir(root)).not.toContain('generated');
  });
  it('records a locked toolchain mismatch before generating', async () => {
    const { root } = await setup();
    await writeFile(
      join(root, 'build-config.lock.json'),
      JSON.stringify({
        schemaVersion: 1,
        configHash: 'fixture',
        toolchain: { '@rune-langium/codegen': '999.0.0' },
        references: {}
      })
    );
    const { snapshot, adapter } = await openLocalProject(root, { privateRoot: join(root, '..', 'private') });
    const result = await buildProject(snapshot, { targets: ['pg'] }, adapter);
    expect(result.status).toBe('failed');
    expect(result.diagnostics.some((issue) => issue.code === 'TOOLCHAIN_MISMATCH')).toBe(true);
    expect(await readdir(root)).not.toContain('generated');
  });
  it('keeps Node backing-private journal files out of the project listing', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'rune-adapter-'));
    temp.push(parent);
    const root = join(parent, 'project');
    await mkdir(root);
    const adapter = await createNodeProjectFileAdapter(root, { privateRoot: join(parent, 'private') });
    await adapter.write('.studio/project-save/journal.json', '{}', null);
    expect(await adapter.list()).toEqual([]);
    expect(await readdir(root)).toEqual([]);
    await expect(adapter.read('../escape')).rejects.toThrow();
  });
});
