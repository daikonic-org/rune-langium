// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { parse, getExpressionRegions, isRosettaFunction } from '@rune-langium/core';
import { renderSourceTypeScriptExpression } from '@rune-langium/codegen/lens';
import { prepareProjectionEdit } from '../../src/services/projection-edit.js';

const wasm = new Uint8Array(
  readFileSync(
    createRequire(import.meta.url)
      .resolve('@vscode/tree-sitter-wasm/package.json')
      .replace(/package\.json$/, 'wasm/tree-sitter-typescript.wasm')
  )
);

it.each([
  { inputs: ['item'], callback: 'item1' },
  { inputs: ['item', 'item1'], callback: 'item2' }
])('restores callback aliases from the displayed owner context ($callback)', async ({ inputs, callback }) => {
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
});
