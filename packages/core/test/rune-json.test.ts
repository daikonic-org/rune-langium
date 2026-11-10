// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { expect, it } from 'vitest';
import {
  decodeRuneJson,
  encodeRuneJson,
  withRuneJsonEncoding,
  normalizeRuneJsonChoiceWrapper,
  projectRuneJsonChoice,
  acceptsRuneJsonChoice,
  selectRuneJsonChoiceCandidates,
  parseProjectPayload,
  serializeProjectPayload
} from '../src/serialization/rune-json.js';

it('shares recursive Choice acceptance and terminates cyclic alternatives without hiding valid siblings', () => {
  const choices = new Map([
    ['Outer', ['Cycle', 'Inner']],
    ['Cycle', ['Outer']],
    ['Inner', ['Quote']]
  ]);
  expect(
    acceptsRuneJsonChoice(
      'Outer',
      (type) => type === 'Quote',
      (type) => choices.get(type)
    )
  ).toBe(true);
  expect(
    acceptsRuneJsonChoice(
      'Outer',
      (type) => type === 'Unknown',
      (type) => choices.get(type)
    )
  ).toBe(false);
});

it('prefers exact Data arms among matching candidates while retaining nested ambiguity', () => {
  const kind = (candidate: string) => candidate !== 'Nested';
  expect(selectRuneJsonChoiceCandidates(['Animal', 'Dog'], (candidate) => candidate === 'Dog', kind)).toEqual(['Dog']);
  expect(selectRuneJsonChoiceCandidates(['Animal', 'Dog', 'Nested'], (candidate) => candidate === 'Dog', kind)).toEqual(
    ['Animal', 'Dog', 'Nested']
  );
  expect(selectRuneJsonChoiceCandidates([], () => true, kind)).toEqual([]);
});

it('serializes native patterns as wire strings and refuses to discard flags', () => {
  expect(encodeRuneJson({ expression: /^x+$/ })).toEqual({ expression: '^x+$' });
  expect(() => encodeRuneJson(/x/i)).toThrow(/flags/);
});

it('shares Choice wrapper normalization without merging parent and arm headers or losing decoded keys', () => {
  const wire = {
    '@type': 'example.Choice',
    '@model': 'outer-model',
    '@version': '1',
    '@key': 'choice-key',
    '@data': { '@type': 'example.Quote', '@model': 'inner-model', '@version': '2', amount: 5 }
  };
  const normalized = normalizeRuneJsonChoiceWrapper(decodeRuneJson(wire), 'example.Choice', (payload) => ({
    quote: payload
  }));
  expect(normalized).toMatchObject({ '@model': 'outer-model', '@version': '1', meta: { globalKey: 'choice-key' } });
  expect(
    encodeRuneJson(projectRuneJsonChoice(normalized!, 'example.Choice', ['quote'], (_arm, value) => value))
  ).toEqual(wire);
  expect(
    normalizeRuneJsonChoiceWrapper(wire, 'example.Other', () => {
      throw new Error('must not unwrap');
    })
  ).toBeUndefined();
});

it('preserves Rune model identity, primitives, metadata and reference namespaces through round trip', () => {
  const wire = {
    '@model': 'cdm',
    '@type': 'cdm.test.Trade',
    '@version': '7.0.0',
    '@key': 'root',
    ids: [
      { '@data': 'GB', '@scheme': 'ISO' },
      { '@data': 'x', '@key': 'id' }
    ],
    party: { '@key:external': 'p', name: 'Party' },
    target: { '@ref': 'id', '@ref:external': 'p', '@ref:scoped': 'here' },
    location: { '@key:scoped': 'here', name: 'Located' },
    unknown: { value: 'an ordinary field' }
  };
  const canonical = decodeRuneJson(wire) as Record<string, unknown>;
  expect(canonical.ids).toEqual([
    { value: 'GB', meta: { scheme: 'ISO' } },
    { value: 'x', meta: { globalKey: 'id' } }
  ]);
  expect(canonical.target).toEqual({
    globalReference: 'id',
    externalReference: 'p',
    reference: { reference: 'here', scope: 'DOCUMENT' }
  });
  expect(encodeRuneJson(canonical)).toEqual(wire);
});
it('keeps no-metadata primitive wrappers and object values distinct', () => {
  for (const wire of [{ '@data': false }, { '@data': 0 }, { '@data': null }, { value: 3 }, [{ '@data': 'a' }]])
    expect(encodeRuneJson(decodeRuneJson(wire))).toEqual(wire);
});
it('rejects ambiguous mixed representations instead of overwriting user fields', () => {
  expect(() => decodeRuneJson({ '@data': 1, other: 2 })).toThrow(/sibling|scalar/);
  expect(() => decodeRuneJson({ '@key': 'a', meta: { globalKey: 'b' } })).toThrow(/conflicting/);
  expect(() => decodeRuneJson({ '@ref': 'a', globalReference: 'b' })).toThrow(/conflicting/);
  expect(() => encodeRuneJson({ meta: { template: 'x' } })).toThrow(/no supported/);
  expect(() => encodeRuneJson({ reference: { reference: 'a', pointsTo: 'b' } })).toThrow(/no supported/);
});
it('does not treat prototype names as serialization markers or mutate input prototypes', () => {
  const wire = JSON.parse('{"__proto__":{"polluted":true},"constructor":"model field"}');
  expect(decodeRuneJson(wire)).toEqual(wire);
  expect({}).not.toHaveProperty('polluted');
});
it('preserves ordinary Data reference properties and inline reference values', () => {
  const ordinary = { reference: 'contract identifier', name: 'Trade' };
  expect(encodeRuneJson(ordinary)).toEqual(ordinary);
  const inline = { '@ref:external': 'party', name: 'Party A' };
  expect(encodeRuneJson(decodeRuneJson(inline))).toEqual(inline);
  expect(() => decodeRuneJson({ '@data': { name: 'not a scalar wrapper' } })).toThrow(/sibling|scalar/);
});

it('distinguishes wire-origin Data attributes from metadata envelopes and refuses context-free ambiguous exports', () => {
  for (const wire of [
    { '@key': 'root', value: 3 },
    { globalReference: 'business-id' },
    { reference: 'business-id' },
    { meta: { globalKey: 'business-field' } }
  ]) {
    expect(encodeRuneJson(decodeRuneJson(wire))).toEqual(wire);
  }
  for (const value of [
    { value: 3, meta: { globalKey: 'root' } },
    { globalReference: 'business-id' },
    { meta: { globalKey: 'business-field' } }
  ]) {
    expect(() => encodeRuneJson(value)).toThrow(/declaration context/);
  }
});

it('rejects unsupported envelope siblings rather than silently dropping them', () => {
  for (const value of [
    { value: 'USD', meta: { scheme: 'iso' }, extra: 'retain-me' },
    { value: { name: 'Party' }, meta: { scheme: 'local' }, extra: 'retain-me' },
    { value: 'USD', meta: {}, '@model': 'unsupported-envelope-header' },
    { globalReference: 'party', extra: 'retain-me' }
  ]) {
    expect(() => encodeRuneJson(withRuneJsonEncoding(value, 'envelope'))).toThrow(/envelope.*supported/);
  }
  const business = { value: 'USD', meta: { scheme: 'ordinary-data' }, extra: 'retain-me' };
  expect(encodeRuneJson(withRuneJsonEncoding(business, 'data'))).toEqual(business);
});

it('round-trips typed Choice @data envelopes, preserving nested metadata and rejecting object siblings', () => {
  const wire = {
    '@type': 'example.Outer',
    '@data': { '@type': 'example.Inner', '@key:scoped': 'inner', '@data': { '@type': 'example.Leaf', amount: 2 } }
  };
  expect(encodeRuneJson(decodeRuneJson(wire))).toEqual(wire);
  const located = { '@key:scoped': 'outer', '@data': wire };
  expect(encodeRuneJson(decodeRuneJson(located))).toEqual(located);
  expect(() => decodeRuneJson({ ...wire, amount: 3 })).toThrow(/sibling/);
  expect(() => decodeRuneJson({ '@data': [] })).toThrow(/scalar/);
});

it('retains context on an inline reference containing a single typed field', () => {
  const wire = { '@ref:scoped': 'basket', basket: { '@type': 'example.Basket', amount: 1 } };
  expect(encodeRuneJson(decodeRuneJson(wire))).toEqual(wire);
});

it('round-trips exact JSON number spellings through cloned data and leaves fields numeric', () => {
  const input = '{"value":1.00,"large":9007199254740993,"rates":[-0,0.0100,2]}';
  const options = { preserveNumberText: true };
  expect(parseProjectPayload(input, 'JSON')).toEqual({
    value: 1,
    large: 9007199254740992,
    rates: [-0, 0.01, 2]
  });
  const parsed = parseProjectPayload(input, 'JSON', options);
  expect(parsed).toMatchObject({
    value: 1,
    large: 9007199254740992,
    rates: [-0, 0.01, 2]
  });
  const output = serializeProjectPayload(structuredClone(parsed), 'JSON', options);
  expect(output.replaceAll(/\s/g, '')).toBe(input);
  const edited = structuredClone(parsed);
  if (!edited || typeof edited !== 'object') throw new TypeError('Expected a JSON object');
  expect(serializeProjectPayload(Object.assign(edited, { value: 2 }), 'JSON', options)).toContain('"value": 2');
});

it('keeps exact number text with its canonical Rune JSON metadata value', () => {
  const input = '{"@data":1.00,"@scheme":"urn:price"}';
  const options = { preserveNumberText: true };
  const parsed = parseProjectPayload(input, 'RUNE_JSON', options);
  expect(parsed).toMatchObject({ value: 1, meta: { scheme: 'urn:price' } });
  expect(serializeProjectPayload(parsed, 'RUNE_JSON', options).replaceAll(/\s/g, '')).toBe(input);
});

it('rejects exact scalar spellings without an owner and preserves exact root arrays', () => {
  const options = { preserveNumberText: true };
  expect(parseProjectPayload('42', 'JSON', options)).toBe(42);
  expect(() => parseProjectPayload('1.00', 'JSON', options)).toThrow('requires a containing object or array');
  expect(() => parseProjectPayload('9007199254740993', 'RUNE_JSON', options)).toThrow(
    'requires a containing object or array'
  );
  const data = parseProjectPayload('[1.00,9007199254740993]', 'JSON', options);
  expect(serializeProjectPayload(structuredClone(data), 'JSON', options).replaceAll(/\s/g, '')).toBe(
    '[1.00,9007199254740993]'
  );
});
