// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * W2 acceptance check (per plan): a corpus-level check that NO attribute in
 * emitted output for the cdm namespace types as `unknown` (TS target) or
 * `z.unknown()` (Zod target) DUE TO CHOICE — i.e. every attribute typed by
 * a `choice` declaration resolves to the Choice's emitted union type/schema,
 * not the generic unresolved-reference fallback.
 *
 * Spot-check type (per plan's own suggestion): `PositionBase.asset` in
 * `cdm.event.position` is typed by `Asset` (`asset Asset (0..1)`), a
 * `choice Asset: Cash / Commodity / Index` declared in a DIFFERENT
 * namespace (`cdm.base.staticdata.asset.common`, base-staticdata-asset-
 * common-type.rosetta) — this exercises the cross-namespace registry path
 * too (isChoice must be consulted the same way isData is in
 * collectCrossNamespaceImports), not just same-file resolution. Also pulls
 * in observable-asset-type.rosetta, whose `Observable` choice (options
 * Asset/Basket/Index) is a second, richer Choice-emission case.
 *
 * Data-extends-Choice (`BasketConstituent extends Observable`) is now
 * handled by `buildAttributeTypesMap` (see docs/superpowers/specs/
 * 2026-07-02-data-extends-choice-design.md) — Observable's option names
 * (`Asset`, `Basket`, `Index`) resolve as pseudo-attributes, so
 * `BasketConstituent.BasketsOfBaskets`'s `Basket is absent` condition no
 * longer emits an "unknown attribute" diagnostic.
 *
 * `.resources/`-guarded per CLAUDE.md convention.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, it, expect } from 'vitest';
import { createRuneDslServices } from '@rune-langium/core';
import { URI } from 'langium';
import { generate } from '../../src/export.js';

const RESOURCES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../.resources');
const CDM_DIR = resolve(RESOURCES_DIR, 'cdm');
const RESOURCES_EXIST = existsSync(CDM_DIR);

const RELEVANT_FILES = [
  'base-staticdata-asset-common-type.rosetta',
  'observable-asset-type.rosetta',
  'event-position-type.rosetta'
];

/**
 * KNOWN, OUT-OF-SCOPE exception (documented — not a Choice-emission bug;
 * unrelated to W2 and out of THIS test's intentionally narrow 3-file
 * scope): "unresolved enumeration 'CurrencyCodeEnum'" — CurrencyCodeEnum is
 * declared in base-staticdata-asset-common-enum.rosetta, a fourth file NOT
 * included in RELEVANT_FILES (this test only needs the Asset/Observable/
 * PositionBase Choice-resolution path, not the full transitive closure of
 * base-staticdata-asset-common-type.rosetta — pulling in the whole CDM
 * corpus to chase every cross-file reference would be disproportionate for
 * a scoped Choice acceptance check). This is Task 1's ToEnumOperation
 * cross-file-reference diagnostic, unrelated to Choice.
 *
 * The former "unknown attribute 'Basket'" exception (Data-extends-Choice)
 * is now fixed — see docs/superpowers/specs/2026-07-02-data-extends-choice-
 * design.md — and no longer needs an entry here.
 */
const KNOWN_DIAGNOSTIC_EXCEPTIONS = ["unresolved enumeration 'CurrencyCodeEnum'"];

async function parseRelevantCdmFiles() {
  const { RuneDsl } = createRuneDslServices();
  const docs = [];
  for (const fileName of RELEVANT_FILES) {
    const path = resolve(CDM_DIR, fileName);
    const content = readFileSync(path, 'utf-8');
    const doc = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
      content,
      URI.parse(pathToFileURL(path).toString())
    );
    docs.push(doc);
  }
  await RuneDsl.shared.workspace.DocumentBuilder.build(docs);
  return docs;
}

describe.skipIf(!RESOURCES_EXIST)('W2 acceptance — Choice-typed attributes never emit as unknown (cdm corpus)', () => {
  it('TypeScript target: PositionBase.asset resolves to the Asset union type, not unknown', async () => {
    const docs = await parseRelevantCdmFiles();
    const outputs = await generate(docs, { target: 'typescript' });
    const positionOutput = outputs.find((o) => o.relativePath.includes('position'));
    expect(positionOutput).toBeDefined();
    expect(positionOutput!.content).toContain('asset?: AssetShape;');
    expect(positionOutput!.content).not.toMatch(/asset\??:\s*unknown/);

    const assetCommonOutput = outputs.find((o) => o.relativePath.includes('common'));
    expect(assetCommonOutput).toBeDefined();
    expect(assetCommonOutput!.content).toContain('export type Asset =');

    // Observable's own three options (Asset/Basket/Index) also resolve.
    // Field-position `unknown` only (`fieldName?: unknown;` / `[]`) — NOT
    // the ordinary `x: unknown` type-guard parameter, which is unrelated
    // and appears in every emitted is<TypeName> guard regardless of Choice.
    const observableOutput = outputs.find((o) => o.relativePath.includes('observable'));
    expect(observableOutput).toBeDefined();
    expect(observableOutput!.content).toContain('export type Observable =');
    expect(observableOutput!.content.slice(observableOutput!.content.indexOf('export type Observable ='))).not.toMatch(
      /\w+\??:\s*unknown(\[\])?;/
    );
  });

  it('Zod target: PositionBase.asset resolves to the AssetSchema reference, not z.unknown()', async () => {
    const docs = await parseRelevantCdmFiles();
    const outputs = await generate(docs, { target: 'zod' });
    const positionOutput = outputs.find((o) => o.relativePath.includes('position'));
    expect(positionOutput).toBeDefined();
    expect(positionOutput!.content).toContain('asset: AssetSchema.optional()');
    expect(positionOutput!.content).not.toContain('asset: z.unknown()');

    const assetCommonOutput = outputs.find((o) => o.relativePath.includes('common'));
    expect(assetCommonOutput).toBeDefined();
    expect(assetCommonOutput!.content).toContain('export const AssetSchema = z.union([');

    const observableOutput = outputs.find((o) => o.relativePath.includes('observable'));
    expect(observableOutput).toBeDefined();
    expect(observableOutput!.content).toContain('export const ObservableSchema = z.union([');
    expect(observableOutput!.content).not.toContain('z.unknown()');
  });

  it('no unexpected error diagnostics from either target (KNOWN_DIAGNOSTIC_EXCEPTIONS excluded, see file header)', async () => {
    const docs = await parseRelevantCdmFiles();
    for (const target of ['typescript', 'zod'] as const) {
      const outputs = await generate(docs, { target });
      for (const output of outputs) {
        const errors = output.diagnostics.filter(
          (d) => d.severity === 'error' && !KNOWN_DIAGNOSTIC_EXCEPTIONS.some((known) => d.message.includes(known))
        );
        expect(
          errors,
          `${target}: ${output.relativePath} has error diagnostics: ${JSON.stringify(errors)}`
        ).toHaveLength(0);
      }
    }
  });
});
