// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { describe, it, expect } from 'vitest';
import { getExpressionRegions, COMPOSITION_MODEL_SOURCE } from '@rune-langium/core';
import { createParserWorkerHarness } from './parser-worker-harness.js';

it('classifies compositions through the serialized parse/link transaction, including a shadowed marker', async () => {
  const worker = createParserWorkerHarness();
  const source =
    'namespace example\nimport rune.studio.*\nfunc Twice:\n [composition]\n inputs: value number (1..1)\n output: result number (1..1)\n alias scaled: value * 2\n set result: scaled';
  const request = {
    type: 'expressionScope' as const,
    composition: true,
    id: 'composition',
    uri: 'file:///owner.rosetta',
    name: 'Twice',
    kind: 'RosettaFunction'
  };
  for (const namespace of ['rune.studio', 'other']) {
    const result = await worker.send({
      ...request,
      files: [
        { name: request.uri, content: source.replace('rune.studio', namespace) },
        { name: 'file:///marker.rosetta', content: COMPOSITION_MODEL_SOURCE.replace('rune.studio', namespace) }
      ]
    });
    expect(result.type).toBe('expressionScopeResult');
    if (result.type !== 'expressionScopeResult') throw new Error('fixture response');
    expect(result.error).toBeUndefined();
    expect(result.composition?.optedIn).toBe(namespace === 'rune.studio');
    expect(result.composition?.supported).toBe(namespace === 'rune.studio');
  }
});

it('loads callable signatures lazily and suggests exact declared types/cardinality without validating by name', async () => {
  const worker = createParserWorkerHarness();
  const source =
    'namespace suggestions\nimport rune.studio.*\nfunc Owner:\n [composition]\n inputs: value number (1..1)\n output: result number (1..1)\n set result: value\nfunc Numeric:\n inputs: amount number (1..1)\n output: result number (1..1)\n set result: amount\nfunc Text:\n inputs: amount string (1..1)\n output: result string (1..1)\n set result: amount';
  const request = {
    type: 'expressionScope' as const,
    composition: true,
    id: 'suggest',
    uri: 'file:///suggestions.rosetta',
    name: 'Owner',
    kind: 'RosettaFunction',
    files: [
      { name: 'file:///suggestions.rosetta', content: source },
      { name: 'file:///marker.rosetta', content: COMPOSITION_MODEL_SOURCE },
      { name: 'file:///types.rosetta', content: 'namespace com.rosetta.model\nbasicType number\nbasicType string\n' }
    ]
  };
  const initial = await worker.send(request);
  if (initial.type !== 'expressionScopeResult') throw new Error('fixture response');
  expect(initial.composition?.callables).toBeUndefined();
  const discovered = await worker.send({ ...request, compositionCallables: true });
  if (discovered.type !== 'expressionScopeResult') throw new Error('fixture response');
  expect(discovered.error).toBeUndefined();
  expect(
    discovered.composition?.callables?.find((entry) => entry.identity === 'suggestions.Numeric')?.accepts['input:value']
  ).toEqual(['amount']);
  expect(
    discovered.composition?.callables?.find((entry) => entry.identity === 'suggestions.Text')?.accepts['input:value']
  ).toBeUndefined();
});

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

it('analyzes a private composition candidate and restores the captured workspace on success and failure', async () => {
  const worker = createParserWorkerHarness();
  const source = `namespace private.candidate
import rune.studio.*
func Owner:
 [composition]
 inputs: value number (1..1)
 output: result number (1..1)
 alias original: value * 2
 set result: original
`;
  const uri = 'file:///candidate.rosetta';
  const files = [
    { name: uri, content: source },
    { name: 'file:///marker.rosetta', content: COMPOSITION_MODEL_SOURCE },
    { name: 'system:///types.rosetta', content: 'namespace com.rosetta.model\nbasicType number\n' }
  ];
  const request = {
    type: 'expressionScope' as const,
    composition: true,
    id: 'private-candidate',
    uri,
    name: 'Owner',
    kind: 'RosettaFunction'
  };
  for (const candidate of [
    source.replaceAll('original', 'replacement'),
    source + '\nfunc : broken',
    source.replace(' set result:', ' alias original: value * 3\n set result:')
  ]) {
    const result = await worker.send({ ...request, files, compositionCandidate: candidate });
    if (result.type !== 'expressionScopeResult') throw new Error('fixture response');
    if (candidate.includes('broken')) expect(result.error).toBeTruthy();
    else if (candidate.includes('value * 3')) {
      expect(result.error).toBeUndefined();
      expect(result.composition?.supported).toBe(false);
      expect(result.composition?.reasons.some((reason) => reason.message.includes('Duplicate shortcut'))).toBe(true);
    } else {
      expect(result.error).toBeUndefined();
      expect(result.composition?.steps.map((step) => step.name)).toEqual(['value', 'replacement', 'result']);
    }
    const restored = await worker.send(request);
    if (restored.type !== 'expressionScopeResult') throw new Error('fixture response');
    expect(restored.error).toBeUndefined();
    expect(restored.composition?.steps.map((step) => step.name)).toEqual(['value', 'original', 'result']);
  }
});
