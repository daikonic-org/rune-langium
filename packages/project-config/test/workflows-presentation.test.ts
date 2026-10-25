// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { expect, it } from 'vitest';
import { declarationKey } from '@rune-langium/core/project-contract';
import { createProjectSnapshot } from '../src/project-snapshot.js';
import { readWorkflows, WorkflowDescriptorSchema } from '../src/workflows.js';
import { readPresentations, PresentationDescriptorSchema } from '../src/presentation.js';
const type = { model: 'local', namespace: 'example', kind: 'Data', name: 'Money' };
const func = { ...type, kind: 'RosettaFunction', name: 'AddMoney' };
const flow = {
  schemaVersion: 1,
  id: 'flow-a',
  name: 'Payment',
  inputs: { value: { kind: 'literal', value: { amount: 10.123456789 } } },
  outputs: { output: { name: 'payment', type } }
};
const layout = {
  schemaVersion: 1,
  type,
  columns: 2,
  fields: { amount: { order: 0, span: 1 }, currency: { order: 1, span: 1 } }
};
const snapshot = (files: [string, string][]) =>
  createProjectSnapshot(
    'p',
    new Map([['studio-config.yml', 'schemaVersion: 1\nworkflows: flows\nlayouts: views\n'], ...files]),
    () => []
  );
it('reads a no-function recipe without persisting execution output or personal view state', async () => {
  const read = readWorkflows(await snapshot([['flows/a.workflow.json', JSON.stringify(flow)]]));
  expect(read.workflows).toEqual([flow]);
  expect(read.diagnostics).toEqual([]);
  for (const extra of [{ result: 42 }, { docking: { x: 3 } }, { selectedId: 'private' }])
    expect(WorkflowDescriptorSchema.safeParse({ ...flow, ...extra }).success).toBe(false);
});
it('retains peer example bindings and reports missing symbols/examples without dropping recipes', async () => {
  const value = {
    ...flow,
    function: func,
    inputs: { first: { kind: 'example', exampleId: 'a' }, second: { kind: 'example', exampleId: 'b' } }
  };
  const read = readWorkflows(await snapshot([['flows/a.workflow.json', JSON.stringify(value)]]), new Set());
  expect(read.workflows).toEqual([value]);
  expect(read.diagnostics.some((issue) => issue.code === 'WORKFLOW_SYMBOL_UNAVAILABLE')).toBe(true);
  expect(read.diagnostics.filter((issue) => issue.code === 'WORKFLOW_EXAMPLE_UNAVAILABLE')).toHaveLength(2);
});
it('preserves distinct workflow IDs and reports duplicate IDs instead of choosing one', async () => {
  const read = readWorkflows(
    await snapshot([
      ['flows/a.workflow.json', JSON.stringify(flow)],
      ['flows/b.workflow.json', JSON.stringify({ ...flow, name: 'Other' })]
    ])
  );
  expect(read.workflows).toHaveLength(2);
  expect(read.diagnostics.some((issue) => issue.code === 'WORKFLOW_DUPLICATE_ID')).toBe(true);
});
it('reads shared object layout and primitive monetary formatting with exact numbers untouched', async () => {
  const amount = { ...type, kind: 'RosettaTypeAlias', name: 'Amount' };
  const format = {
    schemaVersion: 1,
    type: amount,
    fields: { '': { format: { kind: 'currency', currency: 'USD', precision: 2, grouping: true } } }
  };
  const read = readPresentations(
    await snapshot([
      ['views/money.layout.json', JSON.stringify(layout)],
      ['views/amount.layout.json', JSON.stringify(format)]
    ]),
    new Set([declarationKey(type), declarationKey(amount)])
  );
  expect(read.presentations).toEqual([format, layout]);
  expect(read.diagnostics).toEqual([]);
  expect(flow.inputs.value.value.amount).toBe(10.123456789);
});
it('persists stable source paths and refuses runtime list indices or personal layout fields', () => {
  expect(PresentationDescriptorSchema.safeParse({ ...layout, fields: { 'prices.amount': { order: 0 } } }).success).toBe(
    true
  );
  for (const path of ['prices[0].amount', 'prices.0.amount'])
    expect(PresentationDescriptorSchema.safeParse({ ...layout, fields: { [path]: { order: 0 } } }).success).toBe(false);
  expect(PresentationDescriptorSchema.safeParse({ ...layout, selectedId: 'private' }).success).toBe(false);
});
it('retains missing type and unsupported format descriptors with diagnostics', async () => {
  const value = { ...layout, fields: { amount: { format: { kind: 'uninstalled-plugin' } } } };
  const read = readPresentations(await snapshot([['views/a.layout.json', JSON.stringify(value)]]), new Set());
  expect(read.presentations).toEqual([value]);
  expect(read.diagnostics.map((issue) => issue.code)).toContain('PRESENTATION_SYMBOL_UNAVAILABLE');
  expect(read.diagnostics.map((issue) => issue.code)).toContain('PRESENTATION_FORMAT_UNAVAILABLE');
});
it('reads only typed files under configured public roots', async () => {
  const read = readWorkflows(
    await snapshot([
      ['.studio/a.workflow.json', JSON.stringify(flow)],
      ['workflows/a.workflow.json', JSON.stringify(flow)],
      ['flows/scratch.json', JSON.stringify(flow)]
    ])
  );
  expect(read.workflows).toEqual([]);
  expect(readPresentations(await snapshot([['.studio/a.layout.json', JSON.stringify(layout)]])).presentations).toEqual(
    []
  );
});
