// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { it, expect } from 'vitest';
import { canonicalProjectJson } from '../src/canonical-json.js';

it('gives portable identities a locale-independent nested key order', () => {
  expect(canonicalProjectJson({ ä: 1, z: { Z: 2, a: 3 } })).toBe('{"z":{"Z":2,"a":3},"ä":1}');
  expect(canonicalProjectJson({ z: { a: 3, Z: 2 }, ä: 1 })).toBe('{"z":{"Z":2,"a":3},"ä":1}');
});
