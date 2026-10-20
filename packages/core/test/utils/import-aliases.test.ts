// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { describe, it, expect } from 'vitest';
import {
  buildImportAliasMap,
  importAliasCandidates,
  buildImportScope,
  importScopeCandidates
} from '../../src/naming/import-aliases.js';

describe('namespace import aliases', () => {
  it('keeps bare lookup in the file namespace and unaliased imports', () => {
    const scope = buildImportScope('parent', [
      { importedNamespace: 'explicit.Amount' },
      { importedNamespace: 'wildcard.*' },
      { importedNamespace: 'aliasOnly.*', namespaceAlias: 'model' }
    ]);
    expect(importScopeCandidates('Amount', scope)).toEqual([
      'explicit.Amount',
      'parent.Amount',
      'wildcard.Amount',
      'Amount'
    ]);
    expect(importScopeCandidates('model.Amount', scope)).toEqual(['model.Amount', 'aliasOnly.Amount']);
    expect(importScopeCandidates('other.Amount', scope)).toEqual(['other.Amount']);
  });
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
