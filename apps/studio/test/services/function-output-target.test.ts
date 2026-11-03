// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { describe, expect, it, vi } from 'vitest';
import { createRuneDslServices } from '@rune-langium/core';
import { URI, DocumentState } from 'langium';
import type { RosettaModel } from '@rune-langium/core';
import type { FormPreviewSchema } from '@rune-langium/codegen/export';
import { resolveFunctionOutputTarget } from '../../src/services/function-output-target.js';

function model(name: string, elements: object[]): RosettaModel {
  return { name, elements, $document: { state: DocumentState.Linked } } as unknown as RosettaModel;
}

describe('resolveFunctionOutputTarget', () => {
  it('does not resolve lazy output references in a not-yet-linked UI snapshot', () => {
    const { RuneDsl } = createRuneDslServices();
    const document = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
      'namespace local\nfunc Build:\n output: result Missing (1..1)',
      URI.parse('file:///pending.rosetta')
    );
    const warn = vi.spyOn(console, 'warn');
    try {
      expect(resolveFunctionOutputTarget([document.parseResult.value as RosettaModel], 'local.Build')).toBeUndefined();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
  it('uses the hydrated function schema when the declaration is curated', () => {
    const schema: FormPreviewSchema = {
      schemaVersion: 1,
      targetId: 'curated.functions.BuildParty#RosettaFunction',
      title: 'BuildParty',
      kind: 'function',
      status: 'ready',
      fields: [],
      functionOutput: {
        typeFqn: 'curated.types.Party',
        kind: 'data',
        cardinality: { min: 1, max: 1 }
      }
    };

    expect(resolveFunctionOutputTarget([], 'curated.functions.BuildParty', schema)).toEqual({
      typeFqn: 'curated.types.Party',
      kind: 'data'
    });
  });

  it('resolves a linked singular imported Data output', () => {
    const models = model('models', []);
    const funcs = model('funcs', []);
    const party = { $type: 'Data', name: 'Party', $container: models };
    const rename = {
      $type: 'RosettaFunction',
      name: 'Rename',
      $container: funcs,
      inputs: [],
      output: { card: { inf: 1, sup: 1 }, typeCall: { type: { ref: party } } }
    };
    models.elements.push(party as never);
    funcs.elements.push(rename as never);

    expect(resolveFunctionOutputTarget([models, funcs], 'funcs.Rename')).toEqual({
      typeFqn: 'models.Party',
      kind: 'data'
    });
  });

  it('uses the inherited output and rejects collection outputs', () => {
    const types = model('types', []);
    const funcs = model('funcs', []);
    const party = { $type: 'Data', name: 'Party', $container: types };
    const base = {
      $type: 'RosettaFunction',
      name: 'Base',
      $container: funcs,
      inputs: [],
      output: { card: { inf: 1, sup: 1 }, typeCall: { type: { ref: party } } }
    };
    const inherited = {
      $type: 'RosettaFunction',
      name: 'Inherited',
      $container: funcs,
      inputs: [],
      superFunction: { ref: base }
    };
    const many = {
      $type: 'RosettaFunction',
      name: 'Many',
      $container: funcs,
      inputs: [],
      output: { card: { inf: 0, sup: 2 }, typeCall: { type: { ref: party } } }
    };
    types.elements.push(party as never);
    funcs.elements.push(base as never, inherited as never, many as never);

    expect(resolveFunctionOutputTarget([types, funcs], 'funcs.Inherited')).toEqual({
      typeFqn: 'types.Party',
      kind: 'data'
    });
    expect(resolveFunctionOutputTarget([types, funcs], 'funcs.Many')).toBeUndefined();
  });
});
