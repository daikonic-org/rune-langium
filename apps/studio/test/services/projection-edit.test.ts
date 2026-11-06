// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, expect, it, vi } from 'vitest';
import { parse, parseWorkspace, BASICTYPES_ROSETTA, getExpressionRegions, isRosettaFunction } from '@rune-langium/core';
import { renderSourceTypeScriptExpression } from '@rune-langium/codegen/lens';
import { AstUtils } from 'langium';
import { prepareProjectionEdit } from '../../src/services/projection-edit.js';

const wasm = new Uint8Array(
  readFileSync(
    createRequire(import.meta.url)
      .resolve('@vscode/tree-sitter-wasm/package.json')
      .replace(/package\.json$/, 'wasm/tree-sitter-typescript.wasm')
  )
);

afterEach(() => vi.restoreAllMocks());

it.each([
  { hydrated: false, nested: false },
  { hydrated: true, nested: false },
  { hydrated: false, nested: true },
  { hydrated: true, nested: true }
])(
  'edits linked pattern literals with hydrated=$hydrated nested=$nested through captured source',
  async ({ hydrated, nested }) => {
    const source = `namespace test
${nested ? 'type Settings:\n expression pattern (1..1)\n' : ''}
func Pattern:
 output: result ${nested ? 'Settings' : 'pattern'} (1..1)
 set result: ${nested ? "Settings {\n  expression: '^x+$'\n }" : '"^x+$"'}
`;
    const [parsed] = await parseWorkspace([
      { uri: 'file:///pattern.rosetta', content: source },
      { uri: 'file:///basics.rosetta', content: BASICTYPES_ROSETTA }
    ]);
    if (!parsed) throw new Error('Missing pattern fixture');
    expect(parsed.hasErrors).toBe(false);
    const owner = parsed.value.elements.find(isRosettaFunction)!;
    const expression = owner.operations[0]!.expression;
    const region = getExpressionRegions(owner)[0]!.region;
    if (hydrated) for (const node of AstUtils.streamAst(expression)) Reflect.deleteProperty(node, '$cstNode');
    const projected = renderSourceTypeScriptExpression(expression, { owner, trackOrigins: false }).origin;
    expect(projected.code).toContain('/^x+$/');
    expect(projected.fragments).toEqual([]);
    expect(projected.fragmentPaths?.length).toBeGreaterThan(0);
    const edit = await prepareProjectionEdit(
      {
        workspaceGeneration: 1,
        uri: 'file:///pattern.rosetta',
        nodeId: 'test.Pattern#RosettaFunction',
        revision: 1,
        source,
        region,
        readOnly: false
      },
      [region],
      projected.code,
      projected.code.replace('/^x+$/', '/^y+$/'),
      'expression',
      wasm,
      [structuredClone(projected)]
    );
    expect(edit.replacement).toContain('"^y+$"');
    if (nested) expect(edit.replacement).toContain('expression:');
    const updated = source.slice(0, region.from) + edit.replacement + source.slice(region.to);
    expect((await parse(updated)).hasErrors).toBe(false);
  }
);

it.each([
  { inputs: ['item'], callback: 'item1' },
  { inputs: ['item', 'item1'], callback: 'item2' }
])('restores callback aliases from the displayed owner context ($callback)', async ({ inputs, callback }) => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const source = `namespace test
func Filter:
 inputs:
  values number (0..*)
${inputs.map((name) => `  ^${name} number (1..1)`).join('\n')}
 output: result number (0..*)
 set result: values filter [item > 0]
`;
  const parsed = await parse(source);
  expect(parsed.parserErrors.map((error) => error.message)).toEqual([]);
  const owner = parsed.value.elements.find(isRosettaFunction)!;
  const region = getExpressionRegions(owner)[0]!.region;
  const projected = renderSourceTypeScriptExpression(owner.operations[0]!.expression, { owner }).origin;
  expect(projected.code).toContain(`${callback} => ${callback} > 0`);
  const edit = await prepareProjectionEdit(
    {
      workspaceGeneration: 1,
      uri: 'file:///filter.rosetta',
      nodeId: 'test.Filter#RosettaFunction',
      revision: 1,
      source,
      region,
      readOnly: false
    },
    [region],
    projected.code,
    projected.code.replace('> 0', `> ${callback}`),
    'expression',
    wasm,
    // Remote serialized ASTs may have no CST fragments. Studio rebuilds those
    // from its captured source while retaining the emitter's name context.
    [{ ...projected, fragments: [] }]
  );
  expect(edit.replacement).toMatch(/filter\s*\[item > item\]/);
  expect(edit.replacement).not.toContain(callback);
  const updated = source.slice(0, region.from) + edit.replacement + source.slice(region.to);
  expect((await parse(updated)).hasErrors).toBe(false);
  expect(errors).not.toHaveBeenCalled();
});
