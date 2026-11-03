// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, it, expect } from 'vitest';
import { parse } from '../../src/index.js';

/**
 * Helper: parse and assert no errors.
 */
async function parseOk(input: string) {
  const result = await parse(input);
  const allErrors = [
    ...result.lexerErrors.map((e) => `Lexer: ${e.message}`),
    ...result.parserErrors.map((e) => `Parser: ${e.message}`)
  ];
  expect(allErrors, allErrors.join('\n')).toHaveLength(0);
  return result;
}

describe('Annotation Parsing (T092)', () => {
  it('preserves upstream FpML schema documentation before its annotations', async () => {
    const result = await parseOk(`namespace fpml.consolidated
      schema fpml514RecordkeepingXML XML <"Schema serialization guidance">
        [externalConfig]
    `);
    expect(result.value.elements[0]).toMatchObject({
      $type: 'Schema',
      name: 'fpml514RecordkeepingXML',
      definition: 'Schema serialization guidance'
    });
  });
  it('should parse an annotation declaration', async () => {
    const result = await parseOk(`
      namespace test.annots
      version "1.0.0"

      annotation deprecated:
        <"Marks an element as deprecated">
    `);
    expect(result.hasErrors).toBe(false);
  });

  it('should parse annotation with attributes', async () => {
    const result = await parseOk(`
      namespace test.annots
      version "1.0.0"

      annotation metadata:
        <"Custom metadata annotation">
        key string (1..1)
        value string (0..1)
    `);
    expect(result.hasErrors).toBe(false);
  });

  it('should parse annotation reference on a data type', async () => {
    const result = await parseOk(`
      namespace test.annots
      version "1.0.0"

      annotation deprecated:
        <"Marks deprecation">

      type OldTrade:
        [deprecated]
        amount number (1..1)
    `);
    expect(result.hasErrors).toBe(false);
  });

  it('should parse annotation reference with qualifier', async () => {
    const result = await parseOk(`
      namespace test.annots
      version "1.0.0"

      annotation metadata:
        <"Custom metadata">
        key string (1..1)

      type Trade:
        [metadata key "tradeType" = "swap"]
        amount number (1..1)
    `);
    expect(result.hasErrors).toBe(false);
  });
});
