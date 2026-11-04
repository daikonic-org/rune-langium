// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Regression coverage for `resolveTypeofStr`/`resolveBuiltinTsType` in
 * ts-emitter.ts after migrating them onto the shared `resolveTypeCallTarget`
 * resolver (type-ref-resolver.ts). Before the migration, both helpers only
 * recognized a LINKED `RosettaBasicType` and never chased a
 * `RosettaTypeAlias` or recognized a genuinely-linked `RosettaRecordType` —
 * so an alias-to-primitive field's `is<TypeName>` guard silently degraded to
 * a presence-only check, and a locally-declared `recordType date {}` field's
 * guard was skipped entirely on the linked path.
 */

import { describe, it, expect } from 'vitest';
import { createRuneDslServices } from '@rune-langium/core';
import { URI } from 'langium';
import { generate } from '../src/export.js';

async function runTs(content: string, name: string): Promise<string> {
  const { RuneDsl } = createRuneDslServices();
  const doc = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
    content,
    URI.parse(`inmemory:///${name}.rosetta`)
  );
  await RuneDsl.shared.workspace.DocumentBuilder.build([doc]);
  if (doc.parseResult.parserErrors.length > 0) {
    throw new Error(`Parse errors in ${name}: ${doc.parseResult.parserErrors.map((e) => e.message).join(', ')}`);
  }
  const outputs = await generate(doc, { target: 'typescript' });
  if (outputs.length === 0) throw new Error(`No output for ${name}`);
  return outputs[0]!.content;
}

describe('ts-emitter type-guard helpers resolve type-alias/record-type references', () => {
  it('a type-alias-to-primitive field gets a real typeof guard, not just a presence check', async () => {
    const output = await runTs(
      `
        namespace "test.alias"
        version "1"

        typeAlias MyString: string

        type Foo:
          bar MyString (1..1)
      `,
      'alias-typeof'
    );

    expect(output).toContain(`typeof x.bar !== 'string'`);
    expect(output).not.toContain(`x.bar === undefined) return false;`);
  });

  it('a genuinely-linked RosettaRecordType field gets its instanceof guard on the linked path', async () => {
    const output = await runTs(
      `
        namespace "test.record"
        version "1"

        recordType date { day int month int year int }

        type Foo:
          createdAt date (1..1)
      `,
      'record-instanceof'
    );

    expect(output).toContain('instanceof Temporal.PlainDate');
  });

  it('plain builtin, Data, Enum, and Choice fields are unaffected (no regression)', async () => {
    const output = await runTs(
      `
        namespace "test.plain"
        version "1"

        enum Color: RED GREEN BLUE

        type Address:
          street string (1..1)

        choice Shape:
          Address

        type Foo:
          name string (1..1)
          color Color (1..1)
          address Address (1..1)
          shape Shape (0..1)
      `,
      'plain-fields'
    );

    expect(output).toContain(`typeof x.name !== 'string'`);
    // Enum/Data/Choice fields have no typeof/instanceof guard — presence-only checks.
    expect(output).toContain(`x.color === undefined) return false;`);
    expect(output).toContain(`x.address === undefined) return false;`);
  });
});
