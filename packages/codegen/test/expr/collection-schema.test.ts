// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { expect, it } from 'vitest';
import { URI } from 'langium';
import { BASICTYPES_ROSETTA, createRuneDslServices } from '@rune-langium/core';
import { generate } from '../../src/export.js';
import { compileGeneratedTypeScript } from '../helpers/compiled-typescript.js';

it('uses the same scalar-empty and grouped-extraction semantics in generated validators', async () => {
  const { RuneDsl } = createRuneDslServices();
  const factory = RuneDsl.shared.workspace.LangiumDocumentFactory;
  const basics = factory.fromString(BASICTYPES_ROSETTA, URI.parse('inmemory:///basics.rosetta'));
  const doc = factory.fromString(
    `namespace test.collectionSchemas
type Group:
 values int (0..*)
type Holder:
 amount int (0..1)
 groups Group (0..*)
 condition ScalarEmpty: (amount extract [empty]) is absent
 condition Groups: (groups extract [values]) count = groups count
 condition Omission: (groups extract [empty]) is absent
`,
    URI.parse('inmemory:///collection-schema.rosetta')
  );
  await RuneDsl.shared.workspace.DocumentBuilder.build([basics, doc]);
  expect(doc.parseResult.parserErrors).toEqual([]);
  expect(doc.references.filter((reference) => reference.error)).toEqual([]);
  const outputs = await generate([doc], { target: 'zod', strict: true });
  const runtime = compileGeneratedTypeScript<{
    HolderSchema: { safeParse(value: unknown): { success: boolean; error?: unknown } };
  }>(outputs);
  const result = runtime.HolderSchema.safeParse({
    amount: 7,
    groups: [{ values: [] }, { values: [] }, { values: [1] }]
  });
  expect(result.success, JSON.stringify(result.error)).toBe(true);
  expect(runtime.HolderSchema.safeParse({ groups: [] }).success).toBe(true);
});
