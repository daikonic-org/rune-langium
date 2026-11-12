// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Daikonic contributors

import { expect, it } from 'vitest';
import { URI } from 'langium';
import {
  BASICTYPES_ROSETTA,
  COMPOSITION_MODEL_SOURCE,
  createRuneDslServices,
  describeFunctionComposition,
  isRosettaFunction,
  parseExpression
} from '@rune-langium/core';
import { createExpressionStarter, type ExpressionStarterType } from '@rune-langium/visual-editor';

it.each<ExpressionStarterType>([
  'MapOperation',
  'FilterOperation',
  'SortOperation',
  'ReduceOperation',
  'DistinctOperation',
  'FlattenOperation',
  'RosettaCountOperation',
  'SumOperation',
  'RosettaConditionalExpression',
  'DefaultOperation'
])('links and validates a complete %s starter in a real composition', async (type) => {
  const expression = createExpressionStarter(type, 'values');
  const { RuneDsl } = createRuneDslServices();
  const sources = [
    BASICTYPES_ROSETTA,
    COMPOSITION_MODEL_SOURCE,
    `namespace starters
import rune.studio.*
func Example:
 [composition]
 inputs: values number (0..*)
 output: result number (0..*)
 alias chosen: ${expression}
 set result: values
`
  ];
  const documents = sources.map((source, index) =>
    RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(source, URI.parse(`memory:/starter${index}.rosetta`))
  );
  await RuneDsl.shared.workspace.DocumentBuilder.build(documents, { validation: true });
  expect(documents.flatMap((document) => document.parseResult.parserErrors)).toEqual([]);
  expect(
    documents.flatMap((document) => document.diagnostics ?? []).filter((diagnostic) => diagnostic.severity === 1)
  ).toEqual([]);
  const func = documents[2]!.parseResult.value.elements.find(isRosettaFunction)!;
  const composition = describeFunctionComposition(func);
  expect(composition.supported).toBe(true);
  expect(composition.steps.find((step) => step.name === 'chosen')).toMatchObject({
    expressionType: type,
    dependencies: ['input:values']
  });
});

it('retains precedence when wrapping an existing expression', () => {
  const nested = createExpressionStarter('FilterOperation', 'values');
  const counted = createExpressionStarter('RosettaCountOperation', nested);
  expect(parseExpression(counted).value).toMatchObject({
    $type: 'RosettaCountOperation',
    argument: { $type: 'FilterOperation', function: { body: { $type: 'RosettaExistsExpression' } } }
  });
});
