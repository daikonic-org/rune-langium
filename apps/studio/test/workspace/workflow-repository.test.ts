// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { expect, it } from 'vitest';
import { readWorkflows, readPresentations } from '@rune-langium/project-config';
import { createProjectController } from '../../src/workspace/project-controller.js';
import { createProjectFileAdapter } from '../../src/workspace/project-file-adapter.js';
import { createOpfsRoot } from '../setup/opfs-mock.js';
import { saveWorkflow, savePresentation } from '../../src/workspace/workflow-repository.js';
const type = { model: 'local', namespace: 'example', kind: 'Data', name: 'Money' };
async function setup() {
  const adapter = createProjectFileAdapter({
    workspaceId: 'recipes',
    root: createOpfsRoot() as unknown as FileSystemDirectoryHandle,
    privateRoot: createOpfsRoot() as unknown as FileSystemDirectoryHandle,
    isWritable: () => true
  });
  const controller = createProjectController({ workspaceId: 'recipes', adapter, validateTarget: () => [] });
  await controller.load();
  return { adapter, controller };
}
it('saves distinct named no-function recipes, output definitions and presentation through repository readback', async () => {
  const { adapter, controller } = await setup();
  const flow = {
    schemaVersion: 1 as const,
    id: 'a',
    name: 'Payment',
    inputs: { input: { kind: 'literal' as const, value: { amount: 10.123456789 } } },
    outputs: { output: { name: 'payment', type } }
  };
  await saveWorkflow(controller, flow);
  await saveWorkflow(controller, { ...flow, id: 'b', name: 'Other payment' });
  await savePresentation(controller, {
    schemaVersion: 1,
    type,
    columns: 2,
    fields: { amount: { order: 0, span: 1 }, currency: { order: 1, span: 1 } }
  });
  const reopened = createProjectController({ workspaceId: 'recipes', adapter, validateTarget: () => [] });
  const restored = await reopened.load();
  expect(readWorkflows(restored).workflows).toHaveLength(2);
  expect(readWorkflows(restored).workflows.find((entry) => entry.id === 'a')).toEqual(flow);
  expect(readPresentations(restored).presentations[0]?.columns).toBe(2);
  expect([...restored.files.keys()].some((path) => path.startsWith('.studio/'))).toBe(false);
  expect([...restored.files.values()].join('\n')).not.toContain('nativeLayout');
});
it('updates a type presentation without appending duplicates and excludes transient output and indexed paths', async () => {
  const { controller } = await setup();
  const presentation = {
    schemaVersion: 1 as const,
    type,
    fields: { amount: { format: { kind: 'currency', currency: 'USD', precision: 2 } } }
  };
  await savePresentation(controller, presentation);
  await savePresentation(controller, { ...presentation, columns: 3 });
  expect(readPresentations(controller.current()!).presentations).toHaveLength(1);
  await expect(
    savePresentation(controller, { ...presentation, fields: { 'items[0].amount': { span: 1 } } })
  ).rejects.toThrow();
  await expect(
    saveWorkflow(controller, { schemaVersion: 1, id: 'bad', name: 'Bad', inputs: {}, outputs: {}, result: 7 } as never)
  ).rejects.toThrow();
});

it('projects canonical presentation preferences, resets shared fields and migrates only uniquely bound browser symbols', async () => {
  const { createPresentationRepository } = await import('../../src/workspace/form-presentation-repository.js');
  const { declarationKey } = await import('@rune-langium/core/project-contract');
  const { controller } = await setup();
  const amount = { ...type, kind: 'RosettaTypeAlias', name: 'Amount' };
  const source = {
    files: [{ path: 'local.rosetta', dirty: false, content: '', name: 'local' }],
    parsedModels: [
      {
        filePath: 'local.rosetta',
        model: {
          name: 'example',
          elements: [
            { $type: 'Data', name: 'Money' },
            { $type: 'RosettaTypeAlias', name: 'Amount' }
          ]
        }
      }
    ],
    deferredExports: []
  } as never;
  const repo = createPresentationRepository({ controller, source: () => source });
  const key = declarationKey(type),
    amountKey = declarationKey(amount);
  const preferences = {
    layouts: { [key]: { columns: 2 as const, order: ['currency', 'amount'], spans: { amount: 2 as const } } },
    formats: { [amountKey]: { style: 'currency' as const, currency: 'USD', grouping: true, fractionDigits: 2 } }
  };
  await repo.save(preferences);
  expect((await repo.load()).preferences).toEqual(preferences);
  const portable = readPresentations(controller.current()!);
  expect(portable.presentations.find((entry) => entry.type.name === 'Amount')?.fields['']?.format?.precision).toBe(2);
  expect(JSON.stringify(portable.presentations)).not.toContain('data:example.Money');
  const preview = repo.previewLegacy({
    layouts: {
      'data:example.Money': preferences.layouts[key]!,
      'data:missing.Unknown': { columns: 1, order: [], spans: {} }
    },
    formats: { 'typeAlias:example.Amount': preferences.formats[amountKey]! }
  });
  expect(preview.preferences).toEqual(preferences);
  expect(preview.diagnostics).toHaveLength(1);
  await repo.save({ layouts: {}, formats: {} });
  expect((await repo.load()).preferences).toEqual({ layouts: {}, formats: {} });
});

it('captures exact peer example bindings and turns edited drafts into literals without saving execution results', async () => {
  const { captureWorkflowRecipe } = await import('../../src/workspace/workflow-repository.js');
  const first = {
    id: 'one',
    name: 'One',
    typeFqn: 'example.Money',
    typeIdentity: type,
    data: { amount: 10.123456789 },
    createdAt: 0,
    modifiedAt: 0
  };
  const second = { ...first, id: 'two', name: 'Two', data: { amount: 20 } };
  const inputs = { first: first.data, second: { amount: 21 } };
  const recipe = captureWorkflowRecipe({
    id: 'workflow',
    name: 'Payments',
    inputs,
    sourceIds: { first: 'one', second: 'two' },
    records: { one: first, two: second },
    outputs: { result: { name: 'payment', type } }
  });
  expect(recipe.inputs).toEqual({
    first: { kind: 'example', exampleId: 'one' },
    second: { kind: 'literal', value: { amount: 21 } }
  });
  expect(recipe.function).toBeUndefined();
  expect(recipe).not.toHaveProperty('result');
  expect(inputs.first.amount).toBe(10.123456789);
});
