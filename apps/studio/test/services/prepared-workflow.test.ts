// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { expect, it, vi } from 'vitest';
import { type WorkflowPreparation } from '@rune-langium/project-config';
import { captureProjectRuntimeInput } from '../../src/services/project-runtime-input.js';
import { prepareWorkflowData, savePreparedWorkflowData } from '../../src/services/prepared-workflow.js';
import type { prepareHostedDatabase } from '../../src/services/database-preparation.js';
import { createProjectController } from '../../src/workspace/project-controller.js';
import type { ProjectFileAdapter } from '@rune-langium/project-config';
import { projectFileRevision, ProjectFileConflict, isIgnoredProjectEntry } from '@rune-langium/project-config';

const config: WorkflowPreparation = {
  module: 'scripts/prepare.ts',
  driver: 'scripts/driver.js',
  outputs: ['model/provider.rosetta'],
  parameters: { generation: 1 }
};
const source = 'namespace example\nversion "1.0.0"\nfunc Rate:\n output: result number (1..1)\n set result: 1\n';
const preparedSource = source.replace('result: 1', 'result: 2');
const recipe = {
  schemaVersion: 1,
  id: 'data',
  name: 'Data',
  function: { model: 'local', namespace: 'example', name: 'Rate', kind: 'RosettaFunction' },
  inputs: {},
  outputs: {},
  preparation: config
};
async function fixture() {
  const files = new Map([
    ['rune-config.yml', 'model: {name: Example}'],
    ['build-config.yml', 'schemaVersion: 1'],
    ['workflows/data.workflow.json', JSON.stringify(recipe)],
    ['model/provider.rosetta', source],
    ['scripts/prepare.ts', 'export default async () => ({})'],
    ['scripts/driver.js', 'export const version = 1;']
  ]);
  const adapter: ProjectFileAdapter = {
    async list() {
      return [...files.keys()].filter((path) => !path.split('/').some(isIgnoredProjectEntry));
    },
    async read(path) {
      const text = files.get(path);
      return text === undefined ? undefined : { text, revision: await projectFileRevision(text) };
    },
    async write(path, text, expected) {
      const old = await this.read(path);
      if ((old?.revision ?? null) !== expected) throw new ProjectFileConflict(path);
      files.set(path, text);
      return projectFileRevision(text);
    },
    async remove(path, expected) {
      const old = await this.read(path);
      if (old?.revision !== expected) throw new ProjectFileConflict(path);
      files.delete(path);
    }
  };
  const controller = createProjectController({ workspaceId: 'prepare', adapter, validateTarget: () => [] });
  const base = await controller.load();
  const runtime = await captureProjectRuntimeInput(
    base,
    [{ path: 'model/provider.rosetta', name: 'provider.rosetta', content: source, dirty: false }],
    []
  );
  const prepare = vi.fn<typeof prepareHostedDatabase>(async (request) => ({
    schemaVersion: 1,
    executionId: '9eff0b54-f949-47ad-9fd0-794cce5cd58a',
    projectRevision: request.projectRevision,
    queryCount: 1,
    value: { schemaVersion: 1, sources: { 'model/provider.rosetta': preparedSource } }
  }));
  const options = { token: 'test-only', signal: new AbortController().signal, isCurrent: () => true, prepare };
  return { files, base, runtime, prepare, options, controller };
}
it('prepares a revision-bound draft and provenance without changing workspace files', async () => {
  const f = await fixture();
  const result = await prepareWorkflowData(f.runtime, config, { amount: 100 }, f.options);
  expect(result.project.snapshot.files.get('model/provider.rosetta')).toBe(preparedSource);
  expect(result.base.files.get('model/provider.rosetta')).toBe(source);
  expect(f.files.get('model/provider.rosetta')).toBe(source);
  expect(result.project.receipt.revision).toBe(result.project.snapshot.revision);
  expect(result.receipt.sourceRevisions['model/provider.rosetta']).toBe(await projectFileRevision(preparedSource));
  expect(f.prepare.mock.calls[0]?.[0]).toMatchObject({
    input: { inputs: { amount: 100 }, parameters: { generation: 1 } },
    driverRevision: await projectFileRevision(f.files.get(config.driver)!)
  });
  const other = await prepareWorkflowData(f.runtime, config, { amount: 200 }, f.options);
  expect(other.receipt.projectRevision).not.toBe(result.receipt.projectRevision);
  expect(JSON.stringify(result.receipt)).not.toContain('test-only');
});

it('rejects non-JSON inputs before hashing or running preparation', async () => {
  const f = await fixture();
  await expect(prepareWorkflowData(f.runtime, config, { date: new Date() }, f.options)).rejects.toThrow('plain JSON');
  expect(f.prepare).not.toHaveBeenCalled();
});
it('drops canceled and superseded preparation and rejects undeclared output sources', async () => {
  const f = await fixture(),
    pending = Promise.withResolvers<Awaited<ReturnType<typeof prepareHostedDatabase>>>();
  let current = true;
  const request = prepareWorkflowData(
    f.runtime,
    config,
    {},
    {
      ...f.options,
      isCurrent: () => current,
      prepare: async (input) => {
        const value = await f.prepare(input, f.options);
        await pending.promise;
        return value;
      }
    }
  );
  await vi.waitFor(() => expect(f.prepare).toHaveBeenCalledOnce());
  current = false;
  pending.resolve(await f.prepare(f.prepare.mock.calls[0]![0], f.options));
  await expect(request).rejects.toThrow('changed');
  await expect(
    prepareWorkflowData(f.runtime, config, {}, { ...f.options, signal: AbortSignal.abort() })
  ).rejects.toThrow();
  const bad: typeof prepareHostedDatabase = async (input) => ({
    ...(await f.prepare(input, f.options)),
    value: { schemaVersion: 1, sources: { 'model/extra.rosetta': source } }
  });
  await expect(prepareWorkflowData(f.runtime, config, {}, { ...f.options, prepare: bad })).rejects.toThrow('exactly');
  expect(f.files.get('model/provider.rosetta')).toBe(source);
});
it('saves sources and a receipt only through an explicit guarded project transaction', async () => {
  const f = await fixture();
  const result = await prepareWorkflowData(f.runtime, config, {}, f.options);
  await expect(savePreparedWorkflowData(f.controller, result, () => false)).rejects.toThrow('execute again');
  expect(f.files.get('model/provider.rosetta')).toBe(source);
  const saved = await savePreparedWorkflowData(f.controller, result, () => true);
  expect(saved.files.get('model/provider.rosetta')).toBe(preparedSource);
  expect(
    JSON.parse(f.files.get('model/provider.rosetta.' + result.receipt.executionId + '.preparation.json')!)
  ).toEqual(result.receipt);
  expect([...f.files.keys()].some((path) => path.includes('token'))).toBe(false);
});

it.each(['model/provider.rosetta', 'scripts/prepare.ts', 'build-config.yml'])(
  'preserves concurrent edits to %s and writes no receipt',
  async (path) => {
    const f = await fixture();
    const result = await prepareWorkflowData(f.runtime, config, {}, f.options);
    const changed = f.files.get(path)! + '\n// concurrent edit\n';
    f.files.set(path, changed);
    await expect(savePreparedWorkflowData(f.controller, result, () => true)).rejects.toThrow();
    expect(f.files.get(path)).toBe(changed);
    if (path !== 'model/provider.rosetta') expect(f.files.get('model/provider.rosetta')).toBe(source);
    expect([...f.files.keys()].some((entry) => entry.endsWith('.preparation.json'))).toBe(false);
  }
);
