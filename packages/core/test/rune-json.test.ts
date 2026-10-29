// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { expect, it } from 'vitest';
import { decodeRuneJson, encodeRuneJson, withRuneJsonEncoding } from '../src/serialization/rune-json.js';

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
