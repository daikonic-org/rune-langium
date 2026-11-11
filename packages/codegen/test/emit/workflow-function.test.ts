// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Daikonic contributors

import { expect, it } from 'vitest';
import { createRuneDslServices, BASICTYPES_ROSETTA } from '@rune-langium/core';
import { URI } from 'langium';
import { renderWorkflowFunction, type WorkflowFunctionDefinition } from '../../src/workflow-function.js';
import { generate } from '../../src/export.js';
import { compileGeneratedTypeScript } from '../helpers/compiled-typescript.js';
import { GENERATED_MODULE_TEST_TIMEOUT } from '../../../../test/helpers/vitest-budget.js';

const definition: WorkflowFunctionDefinition = {
  namespace: 'flows',
  name: 'Compose',
  imports: ['base'],
  inputs: [{ name: 'values', type: 'number', cardinality: { min: 0, max: 'unbounded' } }],
  output: { name: 'result', type: 'number', cardinality: { min: 0, max: 'unbounded' } },
  steps: [
    { name: 'doubled', expression: 'values extract v [Double(v)]' },
    { name: 'positive', expression: 'doubled filter item > 0' }
  ],
  result: 'positive'
};

it(
  'compiles mapped, chained and nested compositions as ordinary callable functions',
  async () => {
    const { RuneDsl } = createRuneDslServices();
    const nested = renderWorkflowFunction({
      ...definition,
      name: 'Nested',
      imports: [],
      steps: [
        { name: 'firstPass', expression: 'Compose(values)' },
        { name: 'secondPass', expression: 'Compose(firstPass)' }
      ],
      result: 'secondPass'
    });
    const objects = renderWorkflowFunction({
      namespace: 'flows',
      name: 'Reprice',
      inputs: [
        { name: 'quote', type: 'base.Quote', cardinality: { min: 1, max: 1 } },
        { name: 'factor', type: 'number', cardinality: { min: 1, max: 1 } }
      ],
      output: { name: 'result', type: 'base.Quote', cardinality: { min: 1, max: 1 } },
      steps: [
        { name: 'scaled', expression: 'base.Scale(quote, factor)' },
        { name: 'rescaled', expression: 'base.Scale(scaled, factor)' }
      ],
      result: 'rescaled'
    });
    const docs = [
      BASICTYPES_ROSETTA,
      `namespace base
func Double:
 inputs: value number (1..1)
 output: result number (1..1)
 set result: value * 2
type Quote:
 amount number (1..1)
 currency string (1..1)
func Scale:
 inputs:
  quote Quote (1..1)
  factor number (1..1)
 output: result Quote (1..1)
 set result: Quote { amount: quote -> amount * factor, currency: quote -> currency }
`,
      renderWorkflowFunction(definition),
      nested,
      objects
    ].map((text, i) =>
      RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(text, URI.parse(`memory:/flow${i}.rosetta`))
    );
    await RuneDsl.shared.workspace.DocumentBuilder.build(docs, { validation: true });
    expect(docs.flatMap((doc) => doc.parseResult.parserErrors)).toEqual([]);
    expect(docs.flatMap((doc) => doc.diagnostics ?? []).filter((d) => d.severity === 1)).toEqual([]);
    const generated = await generate(docs, { target: 'typescript' });
    const compiled = compileGeneratedTypeScript<{
      Compose(values: number[]): number[];
      Nested(values: number[]): number[];
      Reprice(quote: { amount: number; currency: string }, factor: number): { amount: number; currency: string };
    }>(generated, { entry: 'flows.ts' });
    const values = [-1, 0, 2, 3];
    expect(compiled.Compose(values)).toEqual([4, 6]);
    expect(compiled.Nested(values)).toEqual([8, 12]);
    expect(values).toEqual([-1, 0, 2, 3]);
    const quote = { amount: 5, currency: 'USD' };
    expect(compiled.Reprice(quote, 2)).toMatchObject({ amount: 20, currency: 'USD' });
    expect(quote.amount).toBe(5);
  },
  GENERATED_MODULE_TEST_TIMEOUT
);

it('rejects conflicting names, malformed expressions and invalid cardinalities before persistence', () => {
  expect(() => renderWorkflowFunction({ ...definition, steps: [{ name: 'values', expression: '1' }] })).toThrow(
    'already used'
  );
  expect(() => renderWorkflowFunction({ ...definition, steps: [{ name: 'stage', expression: 'if' }] })).toThrow(
    'Step stage'
  );
  expect(() => renderWorkflowFunction({ ...definition, namespace: 'flow\nfunc Injected:' })).toThrow('Namespace');
  expect(() =>
    renderWorkflowFunction({ ...definition, output: { ...definition.output, cardinality: { min: 2, max: 1 } } })
  ).toThrow('Cardinality');
});
