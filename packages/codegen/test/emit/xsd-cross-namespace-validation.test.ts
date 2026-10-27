// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { expect, it } from 'vitest';
import { URI } from 'langium';
import { BASICTYPES_ROSETTA, createRuneDslServices, assertValidDocuments } from '@rune-langium/core';
import { generate } from '../../src/export.js';
import { validateGeneratedXsd } from '../../../../test/helpers/xsd-validation.js';

it('compiles nested schema imports for foreign enums, data, choices and inheritance', async () => {
  const { RuneDsl } = createRuneDslServices();
  const texts = [
    BASICTYPES_ROSETTA,
    `namespace domain.base
enum Currency:
 EUR
type Party:
 partyId string (1..1)
choice Asset:
 Party
 string`,
    `namespace domain.product.trade
import domain.base.*
type Trade extends Party:
 asset Asset (1..1)
 currency Currency (1..1)
 party Party (1..1)`
  ];
  const documents = texts.map((text, index) =>
    RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(text, URI.parse(`inmemory:///xsd-${index}.rosetta`))
  );
  await RuneDsl.shared.workspace.DocumentBuilder.build(documents, { validation: true, eagerLinking: true });
  assertValidDocuments(documents);
  const outputs = await generate(documents, { target: 'xsd' });
  const xml = (currency: string) => `
<Document xmlns="urn:rune:test" xmlns:b="urn:rune:domain.base" xmlns:t="urn:rune:domain.product.trade">
  <b:partyId>party-1</b:partyId>
  <t:asset><b:party><b:partyId>party-2</b:partyId></b:party></t:asset>
  <t:currency>${currency}</t:currency>
  <t:party><b:partyId>party-3</b:partyId></t:party>
</Document>`;
  const entry = { path: 'domain/product/trade.xsd', namespace: 'urn:rune:domain.product.trade', type: 'Trade' };
  const valid = validateGeneratedXsd(outputs, entry, xml('EUR'));
  expect(valid.status, valid.error ?? valid.stderr).toBe(0);
  const invalid = validateGeneratedXsd(outputs, entry, xml('USD'));
  expect(invalid.status).not.toBe(0);
  expect(invalid.stderr).toMatch(/enumeration/);
});
