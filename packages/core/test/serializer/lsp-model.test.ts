// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { describe, it, expect } from 'vitest';
import { compactLspModelJson, readLspModelMetadata } from '../../src/serializer/lsp-model.js';

describe('semantic LSP model transport', () => {
  it('preserves semantics and declaration ranges without dependency token/source spans', () => {
    const name = { range: { start: { line: 1, character: 5 }, end: { line: 1, character: 9 } } };
    const model = {
      $type: 'RosettaModel',
      name: 'example',
      $sourceText: 'source',
      elements: [
        {
          $type: 'Data',
          name: 'Tree',
          $textRegion: { range: name.range, assignments: { name: [name], attributes: [{}] } },
          child: {
            $type: 'TypeCall',
            $cstText: 'Tree',
            $textRegion: { offset: 30 },
            type: { $ref: '#/elements@0', $refText: 'Tree' }
          }
        }
      ]
    };
    const compact = JSON.parse(compactLspModelJson(JSON.stringify(model)));
    expect(compact.$sourceText).toBeUndefined();
    expect(compact.elements[0].$textRegion.assignments).toEqual({ name: [name] });
    expect(compact.elements[0].child.$textRegion).toBeUndefined();
    expect(compact.elements[0].child.$cstText).toBeUndefined();
    expect(compact.elements[0].child.type).toEqual({ $ref: '#/elements@0', $refText: 'Tree' });
  });
  it('reads qualified body references and multi-reference edges from canonical JSON', () => {
    const json = JSON.stringify({
      name: { segments: ['example', 'model'] },
      imports: [{ importedNamespace: 'other.*' }],
      $textRegion: { documentURI: 'file:///a.rosetta' },
      elements: [
        {
          body: { $ref: 'file:///b.rosetta#/elements@1', $refText: 'Other' },
          local: { $ref: '#/elements@0', $refText: 'Self' },
          many: { $refs: ['file:///b.rosetta#/elements@2', 'file:///c.rosetta#/elements@1'] }
        }
      ]
    });
    expect(readLspModelMetadata(json)).toEqual({
      namespace: 'example.model',
      sourceUri: 'file:///a.rosetta',
      imports: ['other.*'],
      references: ['file:///b.rosetta', 'file:///c.rosetta'],
      hasImplementationSources: false,
      declarations: []
    });
  });

  it('records implementation source presence separately from source validation', () => {
    const pack = { schemaVersion: 1, model: 'cdm', commit: 'a'.repeat(40), files: [] };
    expect(
      readLspModelMetadata(JSON.stringify({ name: 'example', $implementationSources: pack })).hasImplementationSources
    ).toBe(true);
    expect(readLspModelMetadata('{"name":"example"}').hasImplementationSources).toBe(false);
  });
});

it('reports authored root names separately from qualified linker aliases', () => {
  expect(
    readLspModelMetadata(
      JSON.stringify({
        name: 'example',
        elements: [
          { $type: 'RosettaFunction', name: 'Caller', inputs: [{ name: 'amount' }] },
          { $type: 'Data', name: 'Trade' }
        ]
      })
    ).declarations
  ).toEqual([
    { type: 'RosettaFunction', name: 'Caller' },
    { type: 'Data', name: 'Trade' }
  ]);
});
