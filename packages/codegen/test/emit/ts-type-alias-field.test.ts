// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * unified-type-reference-resolution Task 4 — ts-emitter's `resolveTypeExprAsTs`
 * now delegates to the shared `resolveTypeCallTarget` resolver
 * (type-ref-resolver.ts, Task 1), which transparently chases
 * `RosettaTypeAlias` chains. Before this migration, an ATTRIBUTE typed
 * directly by a type alias fell through every isRosettaBasicType/
 * isRosettaEnumeration/isData/isChoice branch in the hand-rolled chain and
 * silently degraded to `unknown` — this file is the regression guard for
 * that specific integration point (mirrors zod-type-alias-field.test.ts,
 * Task 3's sibling migration).
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

describe('ts-emitter — attribute typed via a type-alias reference', () => {
  it('resolves a field typed via a type-alias-to-primitive to the correct TypeScript type', async () => {
    const source = `
namespace test.aliasField
version "0.0.0"

typeAlias MyAlias: string

type Foo:
    bar MyAlias (0..1)
`;
    const doc = await parseSource(source);
    const model = walkNamespace([doc], 'test.aliasField');
    const output = emitNamespace(model, {});
    expect(output.content).toContain('bar?: string;');
    expect(output.content).not.toContain('bar?: unknown;');
  });

  it('resolves a field typed via a type-alias-to-Data to the Data interface reference', async () => {
    const source = `
namespace test.aliasField2

version "0.0.0"

type Bar:
    x string (0..1)

typeAlias MyAlias: Bar

type Foo:
    bar MyAlias (0..1)
`;
    const doc = await parseSource(source);
    const model = walkNamespace([doc], 'test.aliasField2');
    const output = emitNamespace(model, {});
    expect(output.content).toContain('bar?: Bar;');
    expect(output.content).not.toContain('bar?: unknown;');
  });
});

/**
 * The resolver's `onPrimitive` callback receives the stdlib "type-alias-
 * flavored builtin" name (`int`, `productType`, `eventType`, `calculation`)
 * directly — these are real `RosettaTypeAlias` nodes in the stdlib
 * (base-types.ts) that the resolver deliberately does NOT chase through
 * (see type-ref-resolver.ts's ROSETTA_BASIC_TYPE_NAMES short-circuit).
 * ts-emitter's `this.ctx.builtinTypeMap` (mergeProfileTypeMaps(typescriptProfile))
 * must have entries for all four so `onPrimitive` never falls back to
 * `unknown` for them.
 */
describe('ts-emitter — stdlib alias-flavored builtin primitives', () => {
  it('maps int/productType/eventType/calculation to their distinct TypeScript types, not unknown', async () => {
    const source = `
namespace test.stdlibPrimitives
version "0.0.0"

type Foo:
    a int (0..1)
    b productType (0..1)
    c eventType (0..1)
    d calculation (0..1)
`;
    const doc = await parseSource(source);
    const model = walkNamespace([doc], 'test.stdlibPrimitives');
    const output = emitNamespace(model, {});
    expect(output.content).toContain('a?: number;');
    expect(output.content).toContain('b?: string;');
    expect(output.content).toContain('c?: string;');
    expect(output.content).toContain('d?: string;');
    expect(output.content.match(/export interface FooShape \{([^}]+)\}/)![1]).not.toContain('unknown');
  });
});
