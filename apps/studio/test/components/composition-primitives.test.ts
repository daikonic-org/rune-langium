// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Daikonic contributors

import { expect, it } from 'vitest';
import { compositionNodePresentation } from '../../src/components/compose/composition-primitives.js';

it('labels the actual expression rather than guessing from the variable name', () => {
  const step = { id: 'alias:filter', name: 'filter', dependencies: [], kind: 'expression' as const };
  expect(compositionNodePresentation(step).label).toBe('Expression');
  expect(compositionNodePresentation({ ...step, expressionType: 'RosettaConditionalExpression' }).label).toBe('Branch');
  expect(compositionNodePresentation({ ...step, name: 'chosen', expressionType: 'FilterOperation' }).label).toBe(
    'Filter'
  );
  expect(compositionNodePresentation({ ...step, kind: 'return', expressionType: 'FilterOperation' }).label).toBe(
    'Output'
  );
});

it('keeps per-item calls inside their collection node and direct calls named after the callee', () => {
  const step = {
    id: 'alias:mapped',
    name: 'mapped',
    dependencies: [],
    kind: 'each' as const,
    call: { identity: 'examples.Double', region: { from: 0, to: 0 }, inputs: [], arguments: [] }
  };
  expect(compositionNodePresentation({ ...step, expressionType: 'MapOperation' }).label).toBe('For each');
  expect(compositionNodePresentation({ ...step, kind: 'call', expressionType: 'RosettaSymbolReference' }).label).toBe(
    'Double'
  );
});
