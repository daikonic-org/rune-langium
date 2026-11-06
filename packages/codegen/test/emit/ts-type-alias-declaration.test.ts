// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * unified-type-reference-resolution follow-up — ts-emitter's
 * `emitTypeAliasDeclaration` (the type-alias DECLARATION's own right-hand
 * side, e.g. `typeAlias A: B` — what does `B` resolve to) now delegates to
 * the shared `resolveTypeCallTarget` resolver (type-ref-resolver.ts, Task 1),
 * the same resolver Task 4 migrated `resolveTypeExprAsTs` onto for ATTRIBUTE
 * references. Before this fix, `emitTypeAliasDeclaration` hand-rolled TWO
 * separate, mutually-inconsistent inline builtin-type-name maps (neither
 * sourced from `this.ctx.builtinTypeMap`) with no `isRosettaTypeAlias`
 * branch and no alias-chain-chasing. This file is the regression guard for
 * that alias-declaration-RHS integration point (mirrors
 * ts-type-alias-field.test.ts, Task 4's attribute-side sibling).
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

describe('ts-emitter — type-alias declaration RHS is itself a type alias', () => {
  it('resolves a genuine 2-hop alias chain (A: B, B: string) to the terminal primitive TS type', async () => {
    // Same rationale as zod-type-alias-declaration.test.ts: `A`'s RHS (`B`)
    // is itself `typeAlias B: string`, so this only passes if the resolver
    // chases FROM A's typeCall INTO B's own typeCall to reach `string`.
    const source = `
namespace test.aliasChain
version "0.0.0"

typeAlias B: string

typeAlias A: B
`;
    const doc = await parseSource(source);
    const model = walkNamespace([doc], 'test.aliasChain');
    const output = emitNamespace(model, {});
    expect(output.content).toContain('export type A = string;');
    expect(output.content).not.toContain('export type A = unknown;');
  });

  it('resolves a type-alias declaration RHS pointing at a Data type to the Data Shape reference', async () => {
    const source = `
namespace test.aliasDeclDataRef
version "0.0.0"

type Bar:
    x string (0..1)

typeAlias MyAlias: Bar
`;
    const doc = await parseSource(source);
    const model = walkNamespace([doc], 'test.aliasDeclDataRef');
    const output = emitNamespace(model, {});
    expect(output.content).toContain('export type MyAlias = Bar.Shape;');
    expect(output.content).not.toContain('export type MyAlias = unknown;');
  });
});
