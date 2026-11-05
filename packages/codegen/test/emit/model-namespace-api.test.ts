// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { expect, it } from 'vitest';
import { assertValidDocuments, BASICTYPES_ROSETTA, createRuneDslServices } from '@rune-langium/core';
import { URI } from 'langium';
import { generate } from '../../src/export.js';
import { compileGeneratedTypeScript } from '../helpers/compiled-typescript.js';

it('keeps model names distinct from the merged namespace members', async () => {
  const { RuneDsl } = createRuneDslServices();
  const docs = [
    BASICTYPES_ROSETTA,
    `namespace names
type Input:
 value int (1..1)
type Type:
 input Input (1..1)
type Deep:
 input Input (1..1)
type Selections:
 input Input (1..1)
type Cardinality:
 amount int (1..1)
choice Shape:
 Type
 Deep
type Quote:
 cardinality Cardinality (0..1)
 selected Shape (1..1)
 input Input (1..1)
 selections Selections (1..1)`,
    `namespace hierarchy
enum Type:
 Yes
 No
type Cash:
 amount int (1..1)
choice Asset:
 Cash
type Input extends Asset:
 id string (1..1)
type Leaf extends Input:
 kind Type (1..1)`
  ].map((text, index) =>
    RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(text, URI.parse(`inmemory:///names-${index}.rosetta`))
  );
  await RuneDsl.shared.workspace.DocumentBuilder.build(docs);
  assertValidDocuments(docs);
  const outputs = await generate(docs, { target: 'typescript' });
  outputs.find((output) => output.content.includes('export class Leaf '))!.content += `
const leaf: Leaf.Shape<{ cash: Cash.Shape }> = { cash: { amount: 1 }, id: 'leaf', kind: Type.Yes };
const kind: Type = Leaf.from(leaf).kind;
`;
  const model = outputs.find((output) => output.content.includes('export class Quote '))!;
  const api = compileGeneratedTypeScript<{
    Quote: { from(value: unknown): { input: { value: { unwrap(): unknown } } } };
  }>(outputs, {
    entry: model.relativePath,
    erasableSyntaxOnly: true,
    assertions: `const quote: Quote.Shape = { selected: { type: { input: { value: 1 } } }, input: { value: 2 }, selections: { input: { value: 3 } } }; const value: number = Quote.from(quote).input.value;`
  });
  expect(
    api.Quote.from({
      selected: { type: { input: { value: 1 } } },
      input: { value: 2 },
      selections: { input: { value: 3 } }
    }).input.value
  ).toBe(2);
});
