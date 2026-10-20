// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { describe, it, expect } from 'vitest';
import { buildImportAliasMap, importAliasCandidates } from '../../src/naming/import-aliases.js';

describe('namespace import aliases', () => {
  it('retains every prefix sharing one alias in source order', () => {
    const map = buildImportAliasMap([
      { importedNamespace: 'fpml.asset.*', namespaceAlias: 'fpml' },
      { importedNamespace: 'fpml.shared.*', namespaceAlias: 'fpml' },
      { importedNamespace: 'other.*' }
    ]);
    expect(importAliasCandidates('fpml.Exercise', map)).toEqual([
      'fpml.Exercise',
      'fpml.asset.Exercise',
      'fpml.shared.Exercise'
    ]);
    expect(importAliasCandidates('other.Exercise', map)).toEqual(['other.Exercise']);
    expect(importAliasCandidates('Exercise', map)).toEqual(['Exercise']);
  });
  it('treats aliases as exact identifiers, including prototype-like names', () => {
    const map = buildImportAliasMap([{ importedNamespace: 'namespace.*', namespaceAlias: '__proto__' }]);
    expect(importAliasCandidates('__proto__.Type', map)).toEqual(['__proto__.Type', 'namespace.Type']);
    expect(importAliasCandidates('constructor.Type', map)).toEqual(['constructor.Type']);
  });
});
