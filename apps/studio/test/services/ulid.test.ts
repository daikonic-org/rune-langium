// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateUlid } from '../../src/services/ulid.js';

afterEach(() => vi.restoreAllMocks());
describe('shared workspace/session ULIDs', () => {
  it.each([
    [0, '0000000000'],
    [1, '0000000001'],
    [32, '0000000010'],
    [2 ** 48 - 1, '7ZZZZZZZZZ']
  ] as const)('preserves the ten-character timestamp at %s', (time, prefix) => {
    vi.spyOn(Date, 'now').mockReturnValue(time);
    const id = generateUlid();
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(id.slice(0, 10)).toBe(prefix);
  });
  it('uses fresh cryptographic randomness for the remaining sixteen characters', () => {
    const random = vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
      (array as Uint8Array).fill(255);
      return array;
    });
    expect(generateUlid().slice(10)).toBe('ZZZZZZZZZZZZZZZZ');
    expect(random).toHaveBeenCalledOnce();
    expect(random.mock.calls[0]?.[0]).toBeInstanceOf(Uint8Array);
  });
});
