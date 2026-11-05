// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/** Linked descriptor guards retain alias, native, enum and nested model checks. */

import { describe, it, expect } from 'vitest';
import { createRuneDslServices } from '@rune-langium/core';
import { URI } from 'langium';
import { generate } from '../src/export.js';
import { compileGeneratedTypeScript } from './helpers/compiled-typescript.js';

async function runTs(content: string, name: string) {
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
  return compileGeneratedTypeScript<{
    Foo: { is(value: unknown): boolean; fromJSON(value: unknown): unknown };
  }>(outputs);
}

describe('ts-emitter type-guard helpers resolve type-alias/record-type references', () => {
  it('a type-alias-to-primitive field gets a real typeof guard, not just a presence check', async () => {
    const api = await runTs(
      `
        namespace "test.alias"
        version "1"

        typeAlias MyString: string

        type Foo:
          bar MyString (1..1)
      `,
      'alias-typeof'
    );

    expect(api.Foo.is({ bar: 'valid' })).toBe(true);
    expect(api.Foo.is({ bar: 42 })).toBe(false);
  });

  it('a genuinely-linked RosettaRecordType field gets its instanceof guard on the linked path', async () => {
    const api = await runTs(
      `
        namespace "test.record"
        version "1"

        recordType date { day int month int year int }

        type Foo:
          createdAt date (1..1)
      `,
      'record-instanceof'
    );

    expect(api.Foo.is(api.Foo.fromJSON({ createdAt: '2026-11-04' }))).toBe(true);
    expect(api.Foo.is({ createdAt: '2026-11-04' })).toBe(false);
  });

  it('plain builtin, Data, Enum, and Choice fields are unaffected (no regression)', async () => {
    const api = await runTs(
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

    const valid = { name: 'name', color: 'RED', address: { street: 'Main' } };
    expect(api.Foo.is(valid)).toBe(true);
    expect(api.Foo.is({ ...valid, color: 'unknown' })).toBe(false);
    expect(api.Foo.is({ ...valid, address: { street: 2 } })).toBe(false);
    expect(api.Foo.is({ ...valid, shape: {} })).toBe(false);
  });
});
