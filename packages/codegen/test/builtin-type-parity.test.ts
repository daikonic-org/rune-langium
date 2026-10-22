// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Builtin type parity test — Task #276.
 *
 * For every implemented target profile, asserts that basicTypeMap ∪ recordTypeMap ∪ typeAliasMap
 * covers the full builtin type surface of com.rosetta.model.
 *
 * The expected key set is hardcoded from the spec §1.1 authoritative surface:
 *   - Basic types (5):   boolean, number, string, time, pattern
 *   - Record types (3):  date, dateTime, zonedDateTime
 *   - Type aliases (4):  int, productType, eventType, calculation
 *
 * This test will FAIL if a future profile drops any builtin name.
 * It intentionally does NOT import profile maps lazily — the static import
 * guarantees the check runs against the actual shipped values.
 */

import { describe, it, expect } from 'vitest';
import { zodProfile } from '../src/emit/zod-profile.js';
import { typescriptProfile } from '../src/emit/typescript-profile.js';
import { jsonSchemaProfile } from '../src/emit/json-schema-profile.js';
import type { LanguageProfile } from '../src/emit/language-profile.js';

// ---------------------------------------------------------------------------
// Authoritative builtin type surface (spec §1.1)
// ---------------------------------------------------------------------------

/** Basic types from com.rosetta.model (spec §1.1). */
const EXPECTED_BASIC_TYPES = new Set(['boolean', 'number', 'string', 'time', 'pattern']);

/** Record types from com.rosetta.model (spec §1.1). */
const EXPECTED_RECORD_TYPES = new Set(['date', 'dateTime', 'zonedDateTime']);

/** Type aliases from com.rosetta.model (spec §1.1). */
const EXPECTED_TYPE_ALIASES = new Set(['int', 'productType', 'eventType', 'calculation']);

/** Full builtin type surface — union of all three categories. */
const EXPECTED_ALL_BUILTINS = new Set([...EXPECTED_BASIC_TYPES, ...EXPECTED_RECORD_TYPES, ...EXPECTED_TYPE_ALIASES]);

// ---------------------------------------------------------------------------
// Helper: assert a profile covers all expected names
// ---------------------------------------------------------------------------

function assertProfileCoversBuiltins(profile: LanguageProfile, profileName: string): void {
  const merged = new Set([
    ...Object.keys(profile.basicTypeMap),
    ...Object.keys(profile.recordTypeMap),
    ...Object.keys(profile.typeAliasMap)
  ]);

  for (const name of EXPECTED_ALL_BUILTINS) {
    expect(
      merged.has(name),
      `${profileName}: missing builtin '${name}' from basicTypeMap ∪ recordTypeMap ∪ typeAliasMap`
    ).toBe(true);
  }
}

function assertProfileBasicTypes(profile: LanguageProfile, profileName: string): void {
  for (const name of EXPECTED_BASIC_TYPES) {
    expect(name in profile.basicTypeMap, `${profileName}: basicTypeMap missing '${name}'`).toBe(true);
  }
}

function assertProfileRecordTypes(profile: LanguageProfile, profileName: string): void {
  for (const name of EXPECTED_RECORD_TYPES) {
    expect(name in profile.recordTypeMap, `${profileName}: recordTypeMap missing '${name}'`).toBe(true);
  }
}

function assertProfileTypeAliases(profile: LanguageProfile, profileName: string): void {
  for (const name of EXPECTED_TYPE_ALIASES) {
    expect(name in profile.typeAliasMap, `${profileName}: typeAliasMap missing '${name}'`).toBe(true);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('builtin type parity — all profiles cover the full com.rosetta.model surface', () => {
  const profiles: Array<{ name: string; profile: LanguageProfile }> = [
    { name: 'zodProfile', profile: zodProfile },
    { name: 'typescriptProfile', profile: typescriptProfile },
    { name: 'jsonSchemaProfile', profile: jsonSchemaProfile }
  ];

  for (const { name, profile } of profiles) {
    describe(`${name}`, () => {
      it('covers all basic types', () => {
        assertProfileBasicTypes(profile, name);
      });

      it('covers all record types', () => {
        assertProfileRecordTypes(profile, name);
      });

      it('covers all type aliases', () => {
        assertProfileTypeAliases(profile, name);
      });

      it('union of all three maps covers the full builtin surface', () => {
        assertProfileCoversBuiltins(profile, name);
      });
    });
  }
});

describe('builtin type parity — specific mapping values match spec §4a', () => {
  describe('zodProfile', () => {
    it('maps date → z.iso.date()', () => {
      expect(zodProfile.recordTypeMap['date']).toBe('z.iso.date({ abort: true })');
    });
    it('maps dateTime → z.iso.datetime()', () => {
      expect(zodProfile.recordTypeMap['dateTime']).toBe('z.iso.datetime({ abort: true })');
    });
    it('maps zonedDateTime → z.iso.datetime({offset:true})', () => {
      expect(zodProfile.recordTypeMap['zonedDateTime']).toBe('z.iso.datetime({ offset: true, abort: true })');
    });
    it('maps time → z.iso.time()', () => {
      expect(zodProfile.basicTypeMap['time']).toBe('z.iso.time({ abort: true })');
    });
    it('maps pattern → z.string()', () => {
      expect(zodProfile.basicTypeMap['pattern']).toBe('z.string()');
    });
    it('maps int → z.number().int()', () => {
      expect(zodProfile.typeAliasMap['int']).toBe('z.number().int()');
    });
    it('maps calculation → z.string()', () => {
      expect(zodProfile.typeAliasMap['calculation']).toBe('z.string()');
    });
  });

  describe('typescriptProfile', () => {
    it('maps date → Temporal.PlainDate', () => {
      expect(typescriptProfile.recordTypeMap['date']).toBe('Temporal.PlainDate');
    });
    it('maps dateTime → Temporal.PlainDateTime', () => {
      expect(typescriptProfile.recordTypeMap['dateTime']).toBe('Temporal.PlainDateTime');
    });
    it('maps zonedDateTime → Temporal.ZonedDateTime', () => {
      expect(typescriptProfile.recordTypeMap['zonedDateTime']).toBe('Temporal.ZonedDateTime');
    });
    it('maps time → Temporal.PlainTime', () => {
      expect(typescriptProfile.basicTypeMap['time']).toBe('Temporal.PlainTime');
    });
    it('maps pattern → string', () => {
      expect(typescriptProfile.basicTypeMap['pattern']).toBe('string');
    });
    it('maps int → number', () => {
      expect(typescriptProfile.typeAliasMap['int']).toBe('number');
    });
    it('maps calculation → string', () => {
      expect(typescriptProfile.typeAliasMap['calculation']).toBe('string');
    });
  });

  describe('jsonSchemaProfile', () => {
    it('maps date → {type:string, format:date}', () => {
      expect(jsonSchemaProfile.recordTypeMap['date']).toEqual({ type: 'string', format: 'date' });
    });
    it('maps dateTime → {type:string, format:date-time}', () => {
      expect(jsonSchemaProfile.recordTypeMap['dateTime']).toEqual({ type: 'string', format: 'date-time' });
    });
    it('maps zonedDateTime → {type:string, format:date-time}', () => {
      expect(jsonSchemaProfile.recordTypeMap['zonedDateTime']).toEqual({ type: 'string', format: 'date-time' });
    });
    it('maps time → {type:string, format:time}', () => {
      expect(jsonSchemaProfile.basicTypeMap['time']).toEqual({ type: 'string', format: 'time' });
    });
    it('maps pattern → {type:string}', () => {
      expect(jsonSchemaProfile.basicTypeMap['pattern']).toEqual({ type: 'string' });
    });
    it('maps int → {type:integer}', () => {
      expect(jsonSchemaProfile.typeAliasMap['int']).toEqual({ type: 'integer' });
    });
    it('maps calculation → {type:string}', () => {
      expect(jsonSchemaProfile.typeAliasMap['calculation']).toEqual({ type: 'string' });
    });
  });
});

describe('builtin type parity — libraryFuncMap', () => {
  describe('zodProfile', () => {
    it('Min → Math.min expr', () => {
      expect(zodProfile.libraryFuncMap['Min']).toEqual({ expr: 'Math.min' });
    });
    it('Max → Math.max expr', () => {
      expect(zodProfile.libraryFuncMap['Max']).toEqual({ expr: 'Math.max' });
    });
    it('IsLeapYear → null (not emitted in Zod)', () => {
      expect(zodProfile.libraryFuncMap['IsLeapYear']).toBeNull();
    });
    it('DateRanges → null', () => {
      expect(zodProfile.libraryFuncMap['DateRanges']).toBeNull();
    });
    it('Adjust → null', () => {
      expect(zodProfile.libraryFuncMap['Adjust']).toBeNull();
    });
    it('Within → null', () => {
      expect(zodProfile.libraryFuncMap['Within']).toBeNull();
    });
  });

  describe('typescriptProfile', () => {
    it('Min → Math.min expr', () => {
      expect(typescriptProfile.libraryFuncMap['Min']).toEqual({ expr: 'Math.min' });
    });
    it('Max → Math.max expr', () => {
      expect(typescriptProfile.libraryFuncMap['Max']).toEqual({ expr: 'Math.max' });
    });
    it('IsLeapYear → importFrom runtime sidecar', () => {
      const mapping = typescriptProfile.libraryFuncMap['IsLeapYear'];
      expect(mapping).not.toBeNull();
      expect(typeof (mapping as { importFrom?: string }).importFrom).toBe('string');
    });
    it('DateRanges → null', () => {
      expect(typescriptProfile.libraryFuncMap['DateRanges']).toBeNull();
    });
    it('Adjust → null', () => {
      expect(typescriptProfile.libraryFuncMap['Adjust']).toBeNull();
    });
    it('Within → null', () => {
      expect(typescriptProfile.libraryFuncMap['Within']).toBeNull();
    });
  });
});
