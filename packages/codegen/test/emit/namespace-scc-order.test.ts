// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { expect, it } from 'vitest';
import { URI } from 'langium';
import { BASICTYPES_ROSETTA, createRuneDslServices, assertValidDocuments } from '@rune-langium/core';
import { generate } from '../../src/export.js';
import { compileGeneratedTypeScript } from '../helpers/compiled-typescript.js';

it('initializes a namespace cycle before downstream enum consumers in a single-file Zod bundle', async () => {
  const { RuneDsl } = createRuneDslServices();
  const texts = [
    BASICTYPES_ROSETTA,
    `namespace a
import b.B
enum Kind:
 Allowed
typeAlias DeferredB: B`,
    `namespace b
import a.Kind
type B:
 kind Kind (1..1)`,
    `namespace z
import a.Kind
type Consumer:
 kind Kind (1..1)`
  ];
  const documents = texts.map((text, index) =>
    RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
      text,
      URI.parse(`inmemory:///namespace-cycle-${index}.rosetta`)
    )
  );
  await RuneDsl.shared.workspace.DocumentBuilder.build(documents, { validation: true, eagerLinking: true });
  assertValidDocuments(documents);
  const outputs = await generate(documents, { target: 'zod', zod: { layout: 'single-file' } });
  const module =
    compileGeneratedTypeScript<Record<string, { safeParse(input: unknown): { success: boolean } }>>(outputs);
  expect(module.ConsumerSchema!.safeParse({ kind: 'Allowed' }).success).toBe(true);
  expect(module.ConsumerSchema!.safeParse({ kind: 'Unknown' }).success).toBe(false);
  expect(module.DeferredBSchema!.safeParse({ kind: 'Allowed' }).success).toBe(true);
});
