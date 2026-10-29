// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, it, expect } from 'vitest';
import {
  runeCheckOneOf,
  runeCount,
  runeAttrExists,
  runeToDate,
  runeToTime,
  runeToDateTime,
  runeToZonedDateTime,
  RUNTIME_HELPER_SOURCE
} from '../src/helpers.js';
import ts from 'typescript-classic';

describe('emitted runtime namespace', () => {
  it('preserves falsy values and empty collection semantics through namespaced built-ins', () => {
    const javascript = ts.transpileModule(RUNTIME_HELPER_SOURCE.replace(/^import .*;\n/gm, ''), {
      compilerOptions: { target: ts.ScriptTarget.ESNext }
    }).outputText;
    const evaluate = new Function(
      'value',
      `${javascript}\nreturn {
      exists: rune.exists(value), count: rune.count(value), list: rune.list(value),
      oneOf: rune.checkOneOf([value, null]), date: rune.toDate('2026-10-08')
    };`
    );
    for (const value of [false, 0, '']) {
      expect(evaluate(value)).toEqual({ exists: true, count: 1, list: [value], oneOf: true, date: '2026-10-08' });
    }
    expect(evaluate([])).toEqual({ exists: false, count: 0, list: [], oneOf: false, date: '2026-10-08' });
  });
});

describe('runeCheckOneOf', () => {
  it('returns false for all-undefined values', () => {
    expect(runeCheckOneOf([undefined, undefined, undefined])).toBe(false);
  });

  it('returns true when exactly one value is present', () => {
    expect(runeCheckOneOf([undefined, 'foo', undefined])).toBe(true);
  });

  it('returns false when two values are present', () => {
    expect(runeCheckOneOf(['foo', 'bar', undefined])).toBe(false);
  });

  it('treats null as absent', () => {
    expect(runeCheckOneOf([null, null, 42])).toBe(true);
  });

  it('returns false for empty array', () => {
    expect(runeCheckOneOf([])).toBe(false);
  });

  it('returns false when all values are null', () => {
    expect(runeCheckOneOf([null, null, null])).toBe(false);
  });

  it('returns false when all values are present', () => {
    expect(runeCheckOneOf([1, 2, 3])).toBe(false);
  });
});

describe('runeCount', () => {
  it('returns the length of a non-empty array', () => {
    expect(runeCount(['a', 'b', 'c'])).toBe(3);
  });

  it('returns 0 for an empty array', () => {
    expect(runeCount([])).toBe(0);
  });

  it('returns 0 for undefined', () => {
    expect(runeCount(undefined)).toBe(0);
  });

  it('returns 0 for null', () => {
    expect(runeCount(null)).toBe(0);
  });

  it('returns 1 for a single-element array', () => {
    expect(runeCount([42])).toBe(1);
  });
});

describe('runeAttrExists', () => {
  it('returns true for a string value', () => {
    expect(runeAttrExists('hello')).toBe(true);
  });

  it('returns true for a numeric value', () => {
    expect(runeAttrExists(42)).toBe(true);
  });

  it('returns false for an empty array', () => {
    expect(runeAttrExists([])).toBe(false);
  });

  it('returns true for a non-empty array', () => {
    expect(runeAttrExists(['a'])).toBe(true);
  });

  it('returns false for null', () => {
    expect(runeAttrExists(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(runeAttrExists(undefined)).toBe(false);
  });

  it('returns true for false (boolean false is a valid value)', () => {
    expect(runeAttrExists(false)).toBe(true);
  });

  it('returns true for zero (0 is a valid value)', () => {
    expect(runeAttrExists(0)).toBe(true);
  });
});

describe('runeToDate', () => {
  it('passes through a valid YYYY-MM-DD string', () => {
    expect(runeToDate('2026-07-02')).toBe('2026-07-02');
  });

  it('returns undefined for a non-date-shaped string', () => {
    expect(runeToDate('not-a-date')).toBeUndefined();
  });

  it('returns undefined for a datetime string (wrong shape)', () => {
    expect(runeToDate('2026-07-02T10:00:00')).toBeUndefined();
  });

  it('returns undefined for a non-string value', () => {
    expect(runeToDate(42)).toBeUndefined();
    expect(runeToDate(undefined)).toBeUndefined();
  });
});

describe('runeToTime', () => {
  it('passes through a valid HH:MM:SS string', () => {
    expect(runeToTime('10:30:00')).toBe('10:30:00');
  });

  it('passes through a valid HH:MM:SS.sss string (fractional seconds)', () => {
    expect(runeToTime('10:30:00.123')).toBe('10:30:00.123');
  });

  it('returns undefined for a non-time-shaped string', () => {
    expect(runeToTime('not-a-time')).toBeUndefined();
  });

  it('returns undefined for a non-string value', () => {
    expect(runeToTime(42)).toBeUndefined();
  });
});

describe('runeToDateTime', () => {
  it('passes through a valid local ISO-8601 datetime', () => {
    expect(runeToDateTime('2026-07-02T10:30:00')).toBe('2026-07-02T10:30:00');
  });

  it('passes through fractional seconds', () => {
    expect(runeToDateTime('2026-07-02T10:30:00.500')).toBe('2026-07-02T10:30:00.500');
  });

  it('returns undefined when a zone offset is present (wrong operation)', () => {
    expect(runeToDateTime('2026-07-02T10:30:00Z')).toBeUndefined();
  });

  it('returns undefined for a bare date', () => {
    expect(runeToDateTime('2026-07-02')).toBeUndefined();
  });
});

describe('runeToZonedDateTime', () => {
  it('passes through a Z-suffixed ISO-8601 datetime', () => {
    expect(runeToZonedDateTime('2026-07-02T10:30:00Z')).toBe('2026-07-02T10:30:00Z');
  });

  it('passes through an explicit offset', () => {
    expect(runeToZonedDateTime('2026-07-02T10:30:00+05:00')).toBe('2026-07-02T10:30:00+05:00');
  });

  it('passes through an offset plus IANA zone-id suffix', () => {
    expect(runeToZonedDateTime('2026-07-02T10:30:00+05:00[Asia/Karachi]')).toBe(
      '2026-07-02T10:30:00+05:00[Asia/Karachi]'
    );
  });

  it('returns undefined for a local datetime with no zone', () => {
    expect(runeToZonedDateTime('2026-07-02T10:30:00')).toBeUndefined();
  });
});

describe('RUNTIME_HELPER_SOURCE', () => {
  it('is a non-empty string', () => {
    expect(typeof RUNTIME_HELPER_SOURCE).toBe('string');
    expect(RUNTIME_HELPER_SOURCE.length).toBeGreaterThan(0);
  });

  it('contains the opening comment marker', () => {
    expect(RUNTIME_HELPER_SOURCE).toContain('// --- rune-codegen runtime helpers (inlined) ---');
  });

  it('contains the closing comment marker', () => {
    expect(RUNTIME_HELPER_SOURCE).toContain('// --- end runtime helpers ---');
  });

  it('contains all seven helper function names', () => {
    expect(RUNTIME_HELPER_SOURCE).toContain('runeCheckOneOf');
    expect(RUNTIME_HELPER_SOURCE).toContain('runeCount');
    expect(RUNTIME_HELPER_SOURCE).toContain('runeAttrExists');
    expect(RUNTIME_HELPER_SOURCE).toContain('runeToDate');
    expect(RUNTIME_HELPER_SOURCE).toContain('runeToTime');
    expect(RUNTIME_HELPER_SOURCE).toContain('runeToDateTime');
    expect(RUNTIME_HELPER_SOURCE).toContain('runeToZonedDateTime');
  });
});
