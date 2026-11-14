// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { expect, it } from 'vitest';
import { createProjectSnapshot, createProjectDraftSnapshot } from '../src/project-snapshot.js';
import { WorkflowPreparationSchema } from '../src/preparation.js';
import { readWorkflows, workflowPreparationInputPaths } from '../src/workflows.js';

const preparation = {
  module: 'scripts/prepare.ts',
  driver: 'scripts/driver.js',
  outputs: ['model/provider.rosetta'],
  parameters: { generation: 1 }
};
const recipe = {
  schemaVersion: 1,
  id: 'market',
  name: 'Market',
  function: { model: 'local', namespace: 'example', name: 'Run', kind: 'RosettaFunction' },
  inputs: {},
  outputs: {},
  preparation
};
it('tracks referenced preparation modules and drivers as project inputs without tracking unrelated scripts', async () => {
  const base = await createProjectSnapshot(
    'prepare',
    new Map([
      ['rune-config.yml', 'model: {name: Example}'],
      ['build-config.yml', 'schemaVersion: 1'],
      ['workflows/market.workflow.json', JSON.stringify(recipe)],
      ['scripts/prepare.ts', 'export default () => 1'],
      ['scripts/driver.js', 'export const version = 1'],
      ['scripts/unrelated.ts', 'notes'],
      ['model/provider.rosetta', 'namespace example']
    ]),
    () => []
  );
  expect(workflowPreparationInputPaths(base)).toEqual([preparation.module, preparation.driver]);
  expect(readWorkflows(base).workflows[0]?.preparation).toEqual(preparation);
  for (const path of [preparation.module, preparation.driver])
    expect((await createProjectDraftSnapshot(base, new Map([[path, 'changed']]), () => [])).revision).not.toBe(
      base.revision
    );
  expect(
    (await createProjectDraftSnapshot(base, new Map([['scripts/unrelated.ts', 'other']]), () => [])).revision
  ).toBe(base.revision);
});
it('rejects private, non-normalized, duplicate and mismatched preparation destinations', () => {
  for (const edit of [
    { module: '../prepare.ts' },
    { module: '.studio/token' },
    { driver: 'other/driver.js' },
    { outputs: ['.git/config'] },
    { outputs: ['model/provider.rosetta', 'model/provider.rosetta'] },
    { outputs: ['resources/data.json'] }
  ])
    expect(WorkflowPreparationSchema.safeParse({ ...preparation, ...edit }).success).toBe(false);
});
