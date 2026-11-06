// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { it, expect } from 'vitest';
import { createRuneDslServices } from '@rune-langium/core';
import { generate } from '@rune-langium/codegen/export';
import { URI } from 'langium';
import {
  compileStandaloneValidator,
  createGeneratedModuleLoader
} from '../../src/services/generated-preview-runtime.js';

it('binds same-named condition functions by linked identity without colliding with the Zod binding', async () => {
  const { shared } = createRuneDslServices();
  const sources = [
    `namespace predicates.a
func Check:
 inputs: amount int (1..1)
 output: result boolean (1..1)
 set result: amount > 0
func z:
 inputs: amount int (1..1)
 output: result boolean (1..1)
 set result: amount <> 0
type Left:
 amount int (1..1)
 condition LeftCheck: Check(amount) and z(amount)`,
    `namespace predicates.b
func Check:
 inputs: amount int (1..1)
 output: result boolean (1..1)
 set result: amount < 0
type Right:
 amount int (1..1)
 condition RightCheck: Check(amount)`,
    `namespace examples
type Sample:
 left predicates.a.Left (1..1)
 right predicates.b.Right (1..1)`
  ];
  const documents = sources.map((source, index) =>
    shared.workspace.LangiumDocumentFactory.fromString(source, URI.parse(`file:///predicate-${index}.rosetta`))
  );
  await shared.workspace.DocumentBuilder.build(documents);
  for (const document of documents) expect(document.parseResult.parserErrors).toEqual([]);
  const compiled = await compileStandaloneValidator(documents, 'examples.Sample', 'metadata');
  expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
  expect(compiled.validator?.safeParse({ left: { amount: 2 }, right: { amount: -2 } }).success).toBe(true);
  const invalid = compiled.validator?.safeParse({ left: { amount: 2 }, right: { amount: 2 } });
  expect(invalid?.success).toBe(false);
  if (invalid && !invalid.success) expect(invalid.error.issues[0]?.message).toContain('RightCheck');
});

it('loads real generated classes with cyclic namespace imports without constructing a child before its foreign parent', async () => {
  const { shared } = createRuneDslServices();
  const documents = [
    `namespace types.a
import types.b.*
type Parent:
 child Child (0..1)`,
    `namespace types.b
import types.a.*
type Child extends Parent:
 amount int (1..1)`
  ].map((source, index) =>
    shared.workspace.LangiumDocumentFactory.fromString(source, URI.parse(`file:///${index}.rosetta`))
  );
  await shared.workspace.DocumentBuilder.build(documents);
  for (const document of documents) expect(document.parseResult.parserErrors).toEqual([]);
  const outputs = await generate(documents, { target: 'typescript', typescript: { decorators: false } });
  const modules = createGeneratedModuleLoader(outputs);
  const Parent = modules.load('types/a.ts').Parent as new () => object;
  const Child = modules.load('types/b.ts').Child as new (data: { amount: number }) => object;
  expect(new Child({ amount: 2 })).toBeInstanceOf(Parent);
  expect(modules.load('types/a.ts').Parent).toBe(Parent);
});
