// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, expect, it } from 'vitest';
import { jsonCodec } from '../../src/instances/json-codec.js';

describe('jsonCodec', () => {
  it('parses valid JSON and returns no diagnostics', () => {
    const result = jsonCodec.import('{"name":"Acme"}', 'test.Party');
    expect(result.data).toEqual({ name: 'Acme' });
    expect(result.diagnostics).toEqual([]);
  });

  it('reports a parse-error diagnostic for malformed JSON, distinctly from schema errors', () => {
    const result = jsonCodec.import('{not valid json', 'test.Party');
    expect(result.data).toBeUndefined();
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.kind).toBe('parse-error');
  });

  it('canTarget accepts any type FQN (plain-JSON codec has no schema of its own to match against)', () => {
    expect(jsonCodec.canTarget('anything.At.All')).toBe(true);
  });
});

it('decodes Rune metadata and rejects a mismatched type before binding a workflow input', async () => {
  const { runeJsonCodec } = await import('../../src/instances/json-codec.js');
  const text = JSON.stringify({ '@model': 'test', '@type': 'test.Party', id: { '@data': 'p', '@scheme': 'x' } });
  expect(runeJsonCodec.import(text, 'test.Party#Data')).toEqual({
    data: { '@model': 'test', '@type': 'test.Party', id: { value: 'p', meta: { scheme: 'x' } } },
    diagnostics: []
  });
  expect(runeJsonCodec.import(text, 'test.Trade').diagnostics[0]?.kind).toBe('identity-mismatch');
  expect(runeJsonCodec.import(text, '').diagnostics).toEqual([]);
  expect(runeJsonCodec.import('{', 'test.Party').diagnostics[0]?.kind).toBe('parse-error');
});
