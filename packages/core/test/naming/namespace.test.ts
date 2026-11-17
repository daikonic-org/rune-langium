// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { describe, it, expect } from 'vitest';
import {
  namespaceFromSource,
  namespaceFromModelName,
  importNamespaceDependencies
} from '../../src/naming/namespace.js';

describe('importNamespaceDependencies', () => {
  const namespaces = new Set(['cdm.rates', 'cdm.rates.detail', 'cdm.other']);
  it('includes declaration imports without broadening namespace selectors', () => {
    expect(importNamespaceDependencies('cdm.rates.FloatingRateIndexEnum', namespaces)).toEqual(['cdm.rates']);
    expect(importNamespaceDependencies('cdm.rates', namespaces)).toEqual(['cdm.rates']);
    expect(importNamespaceDependencies('cdm.rates.*', namespaces)).toEqual(['cdm.rates', 'cdm.rates.detail']);
    expect(importNamespaceDependencies('cdm.missing.Type', namespaces)).toEqual([]);
    expect(importNamespaceDependencies('cdm.rates.missing.*', namespaces)).toEqual([]);
    expect(importNamespaceDependencies('Unknown', namespaces)).toEqual([]);
  });
});

describe('namespaceFromSource', () => {
  it('extracts a dotted namespace from source text', () => {
    expect(namespaceFromSource('  namespace cdm.base.datetime\ntype Foo:')).toBe('cdm.base.datetime');
  });
  it('extracts from the first namespace line anywhere in the text', () => {
    expect(namespaceFromSource('// comment\nnamespace test\n')).toBe('test');
  });
  it('returns empty string when there is no namespace', () => {
    expect(namespaceFromSource('type Foo:')).toBe('');
  });
});

describe('namespaceFromModelName', () => {
  it('returns a plain string name unchanged', () => {
    expect(namespaceFromModelName('cdm.base')).toBe('cdm.base');
  });
  it('strips surrounding quotes from a STRING-named namespace', () => {
    expect(namespaceFromModelName('"my namespace"')).toBe('my namespace');
  });
  it('joins a {segments} shape with dots', () => {
    expect(namespaceFromModelName({ segments: ['cdm', 'base', 'datetime'] })).toBe('cdm.base.datetime');
  });
  it('returns undefined for null/unknown shapes', () => {
    expect(namespaceFromModelName(null)).toBeUndefined();
    expect(namespaceFromModelName(undefined)).toBeUndefined();
    expect(namespaceFromModelName(42)).toBeUndefined();
  });
});
