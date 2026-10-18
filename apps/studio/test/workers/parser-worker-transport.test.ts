// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { describe, expect, it } from 'vitest';
import { getExpressionRegions, getFunctionImplementationRegion, isRosettaFunction } from '@rune-langium/core';
import { dispatchWorkerRequest } from '../../src/workers/parser-worker.js';
import { createParserWorkerHarness } from './parser-worker-harness.js';

const source = `namespace transport
// Source coordinates count UTF-16 code units: 🧭
func Read:
 inputs: value int (1..1)
 output: result int (1..1)
 set result: value + 1
 // retained comment
`.replaceAll('\n', '\r\n');

describe('parser worker response transport', () => {
  it('clones parsed source with references, original body text and UTF-16 coordinates', async () => {
    const response = structuredClone(await dispatchWorkerRequest({ type: 'parse', id: 'source', content: source }));
    if (response.type !== 'parseResult' || !response.model) throw new Error('Expected parsed model');
    expect(response.errors).toEqual([]);
    const func = response.model.elements.find(isRosettaFunction)!;
    const region = getFunctionImplementationRegion(func, source);
    expect(source.slice(region.from, region.to)).toContain('set result: value + 1');
    expect(source.slice(region.from, region.to)).toContain('// retained comment');
    expect(getExpressionRegions(func)[0]!.expression).toMatchObject({ $cstText: 'value + 1' });
    expect(func.operations[0]!.assignRoot).toMatchObject({ $refText: 'result' });
    expect(response.model).not.toHaveProperty('$document');
    expect(func).not.toHaveProperty('$cstNode');
  });

  it('clones workspace snapshots without leaking live parser state', async () => {
    const response = structuredClone(
      await dispatchWorkerRequest({
        type: 'parseWorkspace',
        id: 'workspace',
        files: [{ name: 'file:///source.rosetta', content: source }]
      })
    );
    if (response.type !== 'parseWorkspaceResult') throw new Error('Expected workspace');
    expect(response.errors).toEqual({});
    expect(response.models).toHaveLength(1);
    expect(response.parsedModels[0]!.model).toEqual(response.models[0]);
    expect(JSON.parse(response.parsedModels[0]!.serializedModelJson!)).toEqual(response.models[0]);
    await dispatchWorkerRequest({ type: 'parseWorkspace', id: 'replace', files: [] });
    expect(response.models[0]!.elements.find(isRosettaFunction)?.name).toBe('Read');
  });

  it('clones lazily linked curated models and retains linkability inside the worker', async () => {
    const worker = createParserWorkerHarness();
    await worker.send({
      type: 'hydrate',
      id: 'hydrate',
      documents: [
        {
          uri: 'file:///curated.rosetta',
          bundleId: 'cdm',
          content: '',
          serializedModel: worker.serializeSample('transport.curated', 'Curated'),
          exports: [{ name: 'Curated', type: 'Data', path: '/elements@0' }]
        }
      ]
    });
    const response = structuredClone(
      await worker.send({ type: 'linkDocument', id: 'link', uri: 'file:///curated.rosetta' })
    );
    if (response.type !== 'linkDocumentResult') throw new Error('Expected link result');
    expect(response.linked).toBe(true);
    expect(response.newModels).toHaveLength(1);
    expect(response.newModels[0]).not.toHaveProperty('$document');
    const again = structuredClone(
      await worker.send({ type: 'linkDocument', id: 'again', uri: 'file:///curated.rosetta' })
    );
    expect(again).toMatchObject({ linked: true });
  });
});
