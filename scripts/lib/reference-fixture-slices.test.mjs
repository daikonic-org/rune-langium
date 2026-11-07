// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRuneDslServices } from '../../packages/core/dist/index.js';
import { URI } from '../../packages/core/node_modules/langium/lib/index.js';
import { referenceFixtureSlices } from './reference-fixture-slices.mjs';
test('extracts dependency selections from original CST bytes without rendering declarations', () => {
  const { RuneDsl } = createRuneDslServices();
  const source =
    '// upstream header\r\nnamespace fixture.cdm\r\nversion "1.0"\r\n\r\ntype First:\r\n  amount number (1..1)\r\n\r\ntype Second: <"keep docs">\r\n  code string (0..1) // keep comment\r\n';
  const document = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
    source,
    URI.parse('file:///upstream/types.rosetta')
  );
  const model = document.parseResult.value;
  const selected = {
    ...document,
    parseResult: { ...document.parseResult, value: { ...model, elements: [model.elements[1]] } }
  };
  const [slice] = referenceFixtureSlices([document], [selected]);
  const node = model.elements[1].$cstNode;
  assert.equal(
    slice.content,
    source.slice(0, model.elements[0].$cstNode.offset) + source.slice(node.offset, node.end) + '\n'
  );
  assert.equal(slice.name, 'fixture.cdm--types.rosetta');
  assert.ok(slice.content.includes('\r\n'));
  assert.ok(!slice.content.includes('type First:'));
  assert.throws(() => referenceFixtureSlices([], [selected]), /original parsed/);
  assert.equal(model.elements.length, 2);
});
