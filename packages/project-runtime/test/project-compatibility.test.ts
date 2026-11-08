// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { afterEach, expect, it, vi } from 'vitest';
import { createProjectSnapshot } from '@rune-langium/project-config';
import { buildEffectiveProject } from '../src/effective-project.js';
import type * as EffectiveProjectModule from '../src/effective-project.js';
import { reviewProjectCompatibility } from '../src/project-compatibility.js';

vi.mock('../src/effective-project.js', async (importOriginal) => {
  const actual = await importOriginal<typeof EffectiveProjectModule>();
  return { ...actual, buildEffectiveProject: vi.fn(actual.buildEffectiveProject) };
});
afterEach(() => vi.mocked(buildEffectiveProject).mockClear());

it.each(['none', 'example', 'workflow'])(
  'builds a comparison baseline only for saved bindings: %s',
  async (binding) => {
    const files = new Map([
      ['rune-config.yml', 'model: {name: Review}'],
      ['build-config.yml', JSON.stringify({ schemaVersion: 1, sources: ['model/**/*.rosetta'] })],
      [
        'model/main.rosetta',
        'namespace review\ntype Quote:\n amount number (1..1)\nfunc Compute:\n inputs: value number (1..1)\n output: result number (1..1)\n set result: value'
      ]
    ]);
    const snapshot = await createProjectSnapshot('review', new Map(files), () => []);
    if (binding === 'example') {
      files.set(
        'examples/quote.example.json',
        JSON.stringify({
          schemaVersion: 1,
          id: 'quote',
          name: 'Quote',
          type: { model: 'local', namespace: 'review', kind: 'Data', name: 'Quote' },
          payload: 'examples/quote.json',
          codec: 'JSON'
        })
      );
      files.set('examples/quote.json', '{"amount":10}');
    } else if (binding === 'workflow') {
      files.set(
        'workflows/compute.workflow.json',
        JSON.stringify({
          schemaVersion: 1,
          id: 'compute',
          name: 'Compute',
          function: { model: 'local', namespace: 'review', kind: 'RosettaFunction', name: 'Compute' },
          inputs: { value: { kind: 'literal', value: 10 } },
          outputs: {}
        })
      );
    }
    const current = await createProjectSnapshot('review', files, () => []);
    const diagnostics = await reviewProjectCompatibility(current, [], { snapshot, referenceDocuments: [] });
    expect(diagnostics).toEqual([]);
    expect(buildEffectiveProject).toHaveBeenCalledTimes(binding === 'none' ? 1 : 2);
  }
);

it('still validates the proposed graph when there are no saved bindings', async () => {
  const snapshot = await createProjectSnapshot(
    'review',
    new Map([
      ['rune-config.yml', 'model: {name: Review}'],
      ['build-config.yml', '{"schemaVersion":1,"sources":["model/**/*.rosetta"]}'],
      ['model/broken.rosetta', 'namespace review\ntype Broken:\n field MissingType (1..1)']
    ]),
    () => []
  );
  const diagnostics = await reviewProjectCompatibility(snapshot, [], { snapshot, referenceDocuments: [] });
  expect(diagnostics.some((issue) => issue.severity === 'error')).toBe(true);
  expect(buildEffectiveProject).toHaveBeenCalledTimes(1);
});
