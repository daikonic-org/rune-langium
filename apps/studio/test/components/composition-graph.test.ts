// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Daikonic contributors

import { expect, it } from 'vitest';
import type { FunctionComposition } from '@rune-langium/core';
import { compositionEdges } from '../../src/components/compose/composition-graph.js';

const composition: FunctionComposition = {
  optedIn: true,
  supported: true,
  reasons: [],
  steps: [
    { id: 'input:value', name: 'value', kind: 'input', dependencies: [] },
    {
      id: 'alias:copy',
      name: 'copy',
      kind: 'expression',
      variableSource: 'input:value',
      dependencies: ['input:value']
    },
    {
      id: 'return',
      name: 'result',
      kind: 'return',
      dependencies: ['alias:copy'],
      call: {
        identity: 'example.Pair',
        region: { from: 0, to: 10 },
        inputs: [],
        arguments: [],
        argumentVariables: ['alias:copy', 'alias:copy']
      }
    }
  ]
};

it('shows each named argument connection through the shared variable producer', () => {
  expect(compositionEdges(composition)).toEqual([
    expect.objectContaining({ source: 'input:value', target: 'return', targetHandle: 'argument:0' }),
    expect.objectContaining({ source: 'input:value', target: 'return', targetHandle: 'argument:1' })
  ]);
});

it('keeps the collection edge when a draft replaces its matching call argument with a literal', () => {
  const mapped: FunctionComposition = {
    ...composition,
    steps: composition.steps.map((step) =>
      step.kind === 'return' ? { ...step, collectionDependencies: ['alias:copy'] } : step
    )
  };
  const inputEdge = expect.objectContaining({ source: 'input:value', target: 'return', targetHandle: 'input' });
  expect(compositionEdges(mapped)).toContainEqual(inputEdge);
  expect(compositionEdges(mapped, { step: 'return', inputs: [{ handle: 'argument:0' }] })).toEqual([
    expect.objectContaining({ source: 'input:value', target: 'return', targetHandle: 'argument:1' }),
    inputEdge
  ]);
});

it('previews an unapplied input/output binding without retaining the old output edge', () => {
  expect(
    compositionEdges(composition, {
      step: 'draft:new',
      inputs: [{ variable: 'alias:copy', handle: 'input' }],
      output: 'return'
    })
  ).toEqual([
    expect.objectContaining({ source: 'input:value', target: 'draft:new', targetHandle: 'input' }),
    expect.objectContaining({ source: 'draft:new', target: 'return', targetHandle: 'input' })
  ]);
  expect(composition.steps).toHaveLength(3);
});
