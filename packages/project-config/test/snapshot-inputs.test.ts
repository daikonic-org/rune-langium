// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { expect, it } from 'vitest';
import { createProjectSnapshot, projectSourcePaths } from '../src/index.js';

it('shares positive source glob matching and rejects nonportable patterns', () => {
  const files = new Map([
    ['model/a.rosetta', 'a'],
    ['model/nested/b.rosetta', 'b'],
    ['generated/a.rosetta', 'c'],
    ['model/a.json', '{}']
  ]);
  expect(projectSourcePaths(files, ['model/**/*.rosetta'])).toEqual(['model/a.rosetta', 'model/nested/b.rosetta']);
  for (const pattern of ['../*.rosetta', '/tmp/*.rosetta', '!model/*.rosetta'])
    expect(() => projectSourcePaths(files, [pattern])).toThrow(/positive globs/);
});
it('tracks source, lock, resources and shared Studio files while ignoring output and unrelated prose', async () => {
  const files = new Map([
    ['model/a.rosetta', 'namespace a'],
    ['resources/list.csv', 'A'],
    ['examples/a.json', '{}'],
    ['workflows/a.json', '{}'],
    ['layouts/a.json', '{}']
  ]);
  const initial = await createProjectSnapshot('p', files, () => []);
  for (const path of files.keys()) {
    const changed = new Map(files);
    changed.set(path, changed.get(path) + 'changed');
    expect((await createProjectSnapshot('p', changed, () => [])).revision, path).not.toBe(initial.revision);
  }
  const output = new Map(files);
  output.set('generated/a.sql', 'SQL');
  output.set('README.md', 'Notes');
  expect((await createProjectSnapshot('p', output, () => [])).revision).toBe(initial.revision);
});

it('protects the accepted .yaml Rune configuration spelling from target output', async () => {
  const snapshot = await createProjectSnapshot(
    'p',
    new Map([
      ['rune-config.yaml', 'model: {name: Demo}'],
      ['build-config.yml', 'schemaVersion: 1\ntargets:\n x: {generator: sql, output: rune-config.yaml}\n']
    ]),
    () => []
  );
  expect(snapshot.project.diagnostics).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: 'OUTPUT_PROTECTED', target: 'x' })])
  );
});

it('derives editor drafts without losing untouched binary resource identity', async () => {
  const { createProjectDraftSnapshot, projectBytesRevision } = await import('../src/index.js');
  const bytes = new Uint8Array([255, 0, 195]);
  const resourceHash = await projectBytesRevision(bytes);
  const original = await createProjectSnapshot(
    'p',
    new Map([
      ['model/a.rosetta', 'namespace a'],
      ['resources/calendar.bin', new TextDecoder().decode(bytes)]
    ]),
    () => [],
    new Map([['resources/calendar.bin', resourceHash]])
  );
  const unchanged = await createProjectDraftSnapshot(original, new Map(), () => []);
  expect(unchanged.revision).toBe(original.revision);
  const changed = await createProjectDraftSnapshot(
    original,
    new Map([
      ['model/a.rosetta', null],
      ['model/b.rosetta', 'namespace b']
    ]),
    () => []
  );
  expect(changed.revision).not.toBe(original.revision);
  expect(changed.files.has('model/a.rosetta')).toBe(false);
  expect(changed.fileRevisions.get('resources/calendar.bin')).toBe(resourceHash);
  expect(original.files.has('model/a.rosetta')).toBe(true);
});
it('orders portable input paths independently of host collation', async () => {
  const { projectFileRevision } = await import('../src/index.js');
  const files = new Map([
    ['resources/ä', 'a'],
    ['resources/z', 'z']
  ]);
  const expected = await projectFileRevision(
    JSON.stringify([
      ['resources/z', await projectFileRevision('z')],
      ['resources/ä', await projectFileRevision('a')]
    ])
  );
  expect((await createProjectSnapshot('p', files, () => [])).revision).toBe(expected);
});
