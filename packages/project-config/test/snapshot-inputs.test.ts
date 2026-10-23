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
