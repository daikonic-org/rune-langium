// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { expect, it } from 'vitest';
import type { PreviewField } from '@rune-langium/codegen/export';
import { workflowFieldNodeId, workflowSchemaNodeId } from '../../src/services/workflow-fields.js';

it.each([
  ['data', 'Data'],
  ['choice', 'Choice'],
  ['enum', 'RosettaEnumeration'],
  ['typeAlias', 'RosettaTypeAlias']
])('retains %s identity for singular and list references', (kind, astKind) => {
  const field: PreviewField = {
    path: 'value',
    label: 'Value',
    kind: 'string',
    required: true,
    typeSymbol: `${kind}:test.Collision`
  };
  expect(workflowFieldNodeId(field)).toBe(`test.Collision#${astKind}`);
  expect(workflowFieldNodeId({ ...field, kind: 'array', children: [field] })).toBe(`test.Collision#${astKind}`);
});

it('does not manufacture navigation for primitives or unknown symbols', () => {
  for (const typeSymbol of [undefined, 'builtin:number', 'unknown:test.Missing'])
    expect(
      workflowFieldNodeId({ path: 'value', label: 'Value', kind: 'number', required: true, typeSymbol })
    ).toBeUndefined();
});

it('qualifies function schemas independently of same-name types', () => {
  expect(
    workflowSchemaNodeId({
      schemaVersion: 1,
      targetId: 'test.Money',
      title: 'Money',
      kind: 'function',
      fields: [],
      status: 'ready'
    })
  ).toBe('test.Money#RosettaFunction');
});
