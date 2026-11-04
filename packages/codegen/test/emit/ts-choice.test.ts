// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * W2 — ts-emitter Choice emission.
 *
 * Choice field-naming decision (no CDM JSON data-instance fixture exists in
 * .resources/ to check against — verified empirically, only build-tooling
 * JSON is present): each ChoiceOption's discriminant key is the
 * camelCase-first-letter form of its type name (`Cash` -> `cash`). NOTE:
 * this is a DERIVED name (from the option's type), not the same convention
 * as Data attributes (whose field names are author-given `attr.name`,
 * emitted verbatim) — a ChoiceOption has no attribute name of its own (only
 * a typeCall), so camelCasing the type name is the closest defensible
 * analogue, chosen deliberately. A JUDGMENT CALL, not a verified wire
 * format — revisit if a real CDM JSON payload with a Choice-typed field
 * ever lands in the corpus. Documented per spec instruction.
 */

import { createRuneDslServices, isRosettaModel } from '@rune-langium/core';
import { URI } from 'langium';
import { describe, it, expect } from 'vitest';
import { walkNamespace } from '../../src/emit/namespace-walker.js';
import { emitNamespace } from '../../src/emit/ts-emitter.js';

async function parseSource(source: string) {
  const { RuneDsl } = createRuneDslServices();
  const doc = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
    source,
    URI.parse('inmemory:///model.rosetta')
  );
  await RuneDsl.shared.workspace.DocumentBuilder.build([doc]);
  const model = doc.parseResult?.value;
  if (!model || !isRosettaModel(model)) {
    throw new Error('expected a RosettaModel');
  }
  return doc;
}

const FIXTURE = `
namespace test.choice
version "0.0.0"

type Cash:
    amount number (0..1)

type Commodity:
    quantity number (0..1)

choice Asset:
    Cash
    Commodity

type Trade:
    asset Asset (0..1)
`;

describe('ts-emitter — Choice emission (W2)', () => {
  it('emits a key-presence discriminated union type for the Choice', async () => {
    const doc = await parseSource(FIXTURE);
    const model = walkNamespace([doc], 'test.choice');
    const output = emitNamespace(model, {});
    expect(output.content).toContain('export type Asset = { cash: Cash } | { commodity: Commodity };');
  });

  it('emits an exactly-one-of type guard for the Choice', async () => {
    const doc = await parseSource(FIXTURE);
    const model = walkNamespace([doc], 'test.choice');
    const output = emitNamespace(model, {});
    expect(output.content).toContain('is(x: unknown): x is Asset {');
  });

  it('the type guard checks exactly-one-of the option keys via rune.checkOneOf', async () => {
    const doc = await parseSource(FIXTURE);
    const model = walkNamespace([doc], 'test.choice');
    const output = emitNamespace(model, {});
    expect(output.content).toContain(
      'return rune.checkOneOf([("cash" in x ? x.cash : undefined), ("commodity" in x ? x.commodity : undefined)]);'
    );
  });

  it('a Data attribute TYPED BY a Choice resolves to the Choice name, not unknown', async () => {
    const doc = await parseSource(FIXTURE);
    const model = walkNamespace([doc], 'test.choice');
    const output = emitNamespace(model, {});
    expect(output.content).toContain('asset?: Asset.Shape;');
    expect(output.content).not.toMatch(/asset\??:\s*unknown/);
  });

  it('does not emit anything for the Choice as a class (Choice is a type-only union, unlike Data)', async () => {
    const doc = await parseSource(FIXTURE);
    const model = walkNamespace([doc], 'test.choice');
    const output = emitNamespace(model, {});
    expect(output.content).not.toContain('export class Asset');
  });
});
