// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, expect, it } from 'vitest';
import { AstUtils, URI } from 'langium';
import { readFileSync } from 'node:fs';
import {
  BASICTYPES_ROSETTA,
  createRuneDslServices,
  isRosettaRule,
  isRosettaSymbolReference,
  type RosettaModel
} from '../../src/index.js';

async function link(source: string | readonly string[]) {
  const { RuneDsl } = createRuneDslServices();
  const factory = RuneDsl.shared.workspace.LangiumDocumentFactory;
  const basics = factory.fromString(BASICTYPES_ROSETTA, URI.parse('file:///basics.rosetta'));
  const docs = (typeof source === 'string' ? [source] : source).map((text, index) =>
    factory.fromString<RosettaModel>(text, URI.parse(`file:///rules-${index}.rosetta`))
  );
  await RuneDsl.shared.workspace.DocumentBuilder.build([basics, ...docs], { validation: false });
  for (const doc of docs) {
    expect(doc.parseResult.lexerErrors).toEqual([]);
    expect(doc.parseResult.parserErrors.map((error) => error.message)).toEqual([]);
  }
  const document = docs.at(-1)!;
  return { document, errors: document.references.filter((reference) => reference.error) };
}

const fixture = new URL('../../../../test/fixtures/regressions/rule-inference/', import.meta.url);
const types = readFileSync(new URL('types.rosetta', fixture), 'utf8');
const model = types.replace('scope.types', 'scope.rules') + '\n';

describe('rule expression type inference', () => {
  it('infers chained reporting-rule results when the rule shares a type name', async () => {
    const { document, errors } = await link([types, readFileSync(new URL('rules.rosetta', fixture), 'utf8')]);
    expect(errors.map((reference) => reference.error!.message)).toEqual([]);
    const call = [...AstUtils.streamAst(document.parseResult.value)].find(
      (node) => isRosettaSymbolReference(node) && node.symbol.$refText === 'Engine'
    );
    expect(isRosettaSymbolReference(call) && isRosettaRule(call.symbol.ref)).toBe(true);
    expect(document.references.find((reference) => reference.$refText === 'kind')?.ref?.$container).toMatchObject({
      name: 'Engine'
    });
  });

  it.each(['->', '->>'])('binds a rule-root item for %s navigation', async (operator) => {
    const { document, errors } = await link(
      model +
        `
reporting rule Registered from Powered:
 extract item ${operator} specification -> registeredOn
`
    );
    expect(errors.map((reference) => reference.error!.message)).toEqual([]);
    expect(
      document.references.find((reference) => reference.$refText === 'specification')?.ref?.$container
    ).toMatchObject({ name: 'Powered' });
  });

  it('traverses a Choice from the implicit reporting-rule input', async () => {
    const { errors } = await link(
      model +
        `
reporting rule Registered from Vehicle:
 extract item ->> specification -> registeredOn
`
    );
    expect(errors.map((reference) => reference.error!.message)).toEqual([]);
  });

  it('keeps an inner collection item bound to its element type', async () => {
    const { document, errors } = await link(
      model +
        `
type Parts:
 textValue string (1..1)
 specifications Specification (0..*)
reporting rule Labels from Parts:
 specifications extract [item -> textValue]
`
    );
    expect(errors.map((reference) => reference.error!.message)).toEqual([]);
    expect(document.references.find((reference) => reference.$refText === 'textValue')?.ref?.$container).toMatchObject({
      name: 'Specification'
    });
  });

  it('keeps a switch item narrowed to its selected Choice arm', async () => {
    const { document, errors } = await link(
      model +
        `
reporting rule ReadKind from Vehicle:
 item switch
  Powered then item -> engine -> kind,
  default empty
`
    );
    expect(errors.map((reference) => reference.error!.message)).toEqual([]);
    expect(document.references.find((reference) => reference.$refText === 'engine')?.ref?.$container).toMatchObject({
      name: 'Powered'
    });
  });

  it('does not expose fields of the rule input on its returned object', async () => {
    const { errors } = await link(
      model +
        `
reporting rule ReadEngine from Powered: engine
reporting rule Invalid from Powered: ReadEngine -> specification
`
    );
    expect(errors.map((reference) => reference.$refText)).toEqual(['specification']);
  });

  it('terminates when mutually recursive rule results have no inferred type', async () => {
    const { errors } = await link(
      model +
        `
reporting rule First from Powered: Second
reporting rule Second from Powered: First
reporting rule Invalid from Powered: First -> missing
`
    );
    expect(errors.map((reference) => reference.$refText)).toEqual(['missing']);
  });

  it('does not leak unrelated fields into a rule-root item', async () => {
    const { errors } = await link(
      model +
        `
reporting rule Invalid from Specification: item -> kind
`
    );
    expect(errors.map((reference) => reference.$refText)).toEqual(['kind']);
  });
});
