// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { describe, it, expect } from 'vitest';
import { getExpressionRegions } from '@rune-langium/core';
import { createParserWorkerHarness } from './parser-worker-harness.js';

describe('builder scope in the linked parser worker', () => {
  it('reuses the linked document and rejects a stale expression position', async () => {
    const worker = createParserWorkerHarness();
    const source =
      'namespace test\nversion "test"\nfunc Calculate:\n inputs: amount int (1..1)\n output: calculated int (1..1)\n set calculated: amount + 1';
    const parsed = await worker.send({
      type: 'parseWorkspace',
      id: '1',
      files: [{ name: 'file:///scope.rosetta', content: source }]
    });
    if (parsed.type !== 'parseWorkspaceResult') throw new Error('fixture response');
    const owner = parsed.models[0]!.elements.find((e) => e.$type === 'RosettaFunction')!;
    if (owner.$type !== 'RosettaFunction') throw new Error('fixture owner');
    const region = getExpressionRegions(owner)[0]!.region;
    const request = {
      type: 'expressionScope' as const,
      id: '2',
      uri: 'file:///scope.rosetta',
      name: 'Calculate',
      region
    };
    const result = await worker.send(request);
    expect(result.type).toBe('expressionScopeResult');
    if (result.type !== 'expressionScopeResult') throw new Error('fixture scope');
    expect(result.error).toBeUndefined();
    expect(result.entries).toContainEqual(expect.objectContaining({ name: 'calculated', kind: 'output' }));
    const stale = await worker.send({ ...request, id: '3', region: { from: 0, to: 1 } });
    expect(stale).toEqual(
      expect.objectContaining({ entries: [], error: 'The expression source changed. Reopen the builder.' })
    );
  });
});

it('uses canonical inherited and own attribute scope for a new condition without adding one to the model', async () => {
  const worker = createParserWorkerHarness();
  const source =
    'namespace draft.scope\nversion "1"\ntype Security:\n identifier string (1..1)\ntype Cash extends Security:\n currency string (1..1)\n';
  const uri = 'file:///draft-scope.rosetta';
  const files = [{ name: uri, content: source }];
  const parsed = await worker.send({ type: 'parseWorkspace', id: 'draft-1', files });
  if (parsed.type !== 'parseWorkspaceResult') throw new Error('fixture response');
  const before = JSON.stringify(parsed.models);
  const result = await worker.send({
    type: 'expressionScope',
    id: 'draft-2',
    uri,
    name: 'Cash',
    kind: 'Data',
    draftCondition: 'precondition'
  });
  if (result.type !== 'expressionScopeResult') throw new Error('fixture scope');
  expect(result.error).toBeUndefined();
  expect(result.entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: 'currency', kind: 'attribute' }),
      expect.objectContaining({ name: 'identifier', kind: 'attribute' })
    ])
  );
  expect(JSON.stringify(parsed.models)).toBe(before);
});

it('matches the existing function-condition scope for new preconditions and postconditions', async () => {
  const worker = createParserWorkerHarness();
  const uri = 'file:///draft-function-scope.rosetta';
  const files = [
    {
      name: uri,
      content:
        'namespace draft.function\nversion "1"\nfunc Calculate:\n inputs: amount int (1..1)\n output: calculated int (1..1)\n condition Check: amount exists\n post-condition Done: calculated exists\n set calculated: amount\n'
    }
  ];
  const parsed = await worker.send({ type: 'parseWorkspace', id: 'function-1', files });
  if (parsed.type !== 'parseWorkspaceResult') throw new Error('fixture response');
  const owner = parsed.models[0]!.elements.find((element) => element.$type === 'RosettaFunction')!;
  if (owner.$type !== 'RosettaFunction') throw new Error('fixture function');
  for (const kind of ['precondition', 'postcondition'] as const) {
    const region = getExpressionRegions(owner).find((entry) => entry.kind === kind)!.region;
    const existing = await worker.send({
      type: 'expressionScope',
      id: `existing-${kind}`,
      uri,
      name: 'Calculate',
      kind: 'RosettaFunction',
      region
    });
    const draft = await worker.send({
      type: 'expressionScope',
      id: `draft-${kind}`,
      uri,
      name: 'Calculate',
      kind: 'RosettaFunction',
      draftCondition: kind
    });
    if (existing.type !== 'expressionScopeResult' || draft.type !== 'expressionScopeResult')
      throw new Error('fixture scope');
    expect(draft.error).toBeUndefined();
    expect(existing.error).toBeUndefined();
    expect(draft.entries).toEqual(existing.entries);
  }
});
