// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { describe, it, expect } from 'vitest';
import { collectLspWorkspaceModels } from '../../src/services/lsp-workspace-models.js';
import type { LspModelCacheEntry } from '../../src/services/lsp-workspace-models.js';
import type { ParsedWorkspaceModel } from '../../src/services/workspace.js';

const model = { $type: 'RosettaModel', name: 'example', elements: [], imports: [] };
const source = JSON.stringify(model);
const raw = { path: 'a.rosetta', name: 'a.rosetta', content: 'namespace example', dirty: false };
const parsed = { filePath: raw.path, model, serializedModelJson: source } as ParsedWorkspaceModel;

describe('LSP workspace models', () => {
  it('includes raw parser results and curated models without loading curated source', () => {
    const cache = new Map<string, LspModelCacheEntry>();
    const result = collectLspWorkspaceModels(
      [
        raw,
        { ...raw, path: 'cdm/b.rosetta', content: '', bundleId: 'cdm', refOnly: true, serializedModelJson: source }
      ],
      [parsed],
      cache,
      raw.path
    );
    expect(result.map((entry) => entry.uri)).toEqual([
      'file:///workspace/a.rosetta',
      'file:///workspace/cdm/b.rosetta'
    ]);
    expect(result.every((entry) => JSON.parse(entry.modelJson).name === 'example')).toBe(true);
  });
  it('closes wildcard imports and body-only qualified refs without pulling unrelated namespaces', () => {
    const make = (path: string, namespace: string, imports: string[], target?: string) => ({
      ...raw,
      path,
      serializedModelJson: JSON.stringify({
        ...model,
        name: namespace,
        imports: imports.map((importedNamespace) => ({ importedNamespace })),
        elements: target
          ? [{ $type: 'RosettaSymbolReference', symbol: { $ref: target + '#/elements@0', $refText: 'Target' } }]
          : []
      })
    });
    const files = [
      make('a.rosetta', 'a', ['b.*']),
      make('b.rosetta', 'b.detail', [], 'c.rosetta'),
      make('c.rosetta', 'c', ['a']),
      make('unrelated.rosetta', 'unrelated', [])
    ];
    const cache = new Map<string, LspModelCacheEntry>();
    expect(collectLspWorkspaceModels(files, [], cache, 'a.rosetta').map((entry) => entry.uri)).toEqual([
      'file:///workspace/a.rosetta',
      'file:///workspace/b.rosetta',
      'file:///workspace/c.rosetta'
    ]);
    expect(cache.size).toBe(4);
    expect(collectLspWorkspaceModels(files, [], cache, 'unrelated.rosetta').map((entry) => entry.uri)).toEqual([
      'file:///workspace/unrelated.rosetta'
    ]);
    expect(cache.size).toBe(4);
    expect(collectLspWorkspaceModels(files, [], cache)).toEqual([]);
  });
  it('reuses compact models and removes stale workspace entries', () => {
    const cache = new Map<string, LspModelCacheEntry>();
    collectLspWorkspaceModels([raw], [parsed], cache, raw.path);
    const entry = cache.values().next().value;
    collectLspWorkspaceModels([raw], [parsed], cache, raw.path);
    expect(cache.values().next().value).toBe(entry);
    expect(collectLspWorkspaceModels([], [parsed], cache, raw.path)).toEqual([]);
    expect(cache.size).toBe(0);
  });
});

it('includes the explicit override endpoints and their import closure outside the active namespace', async () => {
  const files = [
    { ...raw, path: 'caller.rosetta', serializedModelJson: JSON.stringify({ ...model, name: 'caller' }) },
    { ...raw, path: '[cdm]/original.rosetta', serializedModelJson: JSON.stringify({ ...model, name: 'upstream' }) },
    {
      ...raw,
      path: 'local.rosetta',
      serializedModelJson: JSON.stringify({ ...model, name: 'custom', imports: [{ importedNamespace: 'helpers.*' }] })
    },
    { ...raw, path: 'helpers.rosetta', serializedModelJson: JSON.stringify({ ...model, name: 'helpers.math' }) },
    { ...raw, path: 'other.rosetta', serializedModelJson: JSON.stringify({ ...model, name: 'other' }) }
  ];
  expect(
    collectLspWorkspaceModels(files, [], new Map(), 'caller.rosetta', ['upstream', 'custom']).map((value) => value.uri)
  ).toEqual([
    'file:///workspace/caller.rosetta',
    'file:///%5Bcdm%5D/original.rosetta',
    'file:///workspace/local.rosetta',
    'file:///workspace/helpers.rosetta'
  ]);
});
