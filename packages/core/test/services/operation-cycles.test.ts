// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { URI } from 'langium';
import {
  BASE_TYPE_FILES,
  createRuneDslServices,
  hydrateModelDocuments,
  isRosettaFunction,
  isRosettaFeatureCall
} from '../../src/index.js';

describe('expression inference cycles', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([false, true])(
    'links nested extraction without re-entering href (dependency present: %s)',
    async (linked) => {
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { shared } = createRuneDslServices();
      const source = `namespace cycles
func Read:
 inputs: models Model (0..*)
 output: result string (0..1)
 alias payerPartyReference:
  models -> payerModel
   filter payerAccountReference -> href = "account"
   then extract payerPartyReference -> href
   then distinct only-element
 set result: payerPartyReference
`;
      const dependency = `namespace cycles
type Reference:
 href string (1..1)
type Payer:
 payerAccountReference Reference (0..1)
 payerPartyReference Reference (0..1)
type Model:
 payerModel Payer (0..1)
`;
      const files = [
        ...BASE_TYPE_FILES.map((file) => ({ uri: file.path, content: file.content })),
        { uri: 'file:///read.rosetta', content: source },
        ...(linked ? [{ uri: 'file:///model.rosetta', content: dependency }] : [])
      ];
      const docs = files.map((file) =>
        shared.workspace.LangiumDocumentFactory.fromString(file.content, URI.parse(file.uri))
      );
      await shared.workspace.DocumentBuilder.build(docs, { validation: false });
      const doc = docs.find((doc) => doc.uri.path === '/read.rosetta')!;
      expect(doc.parseResult.parserErrors).toEqual([]);
      const hrefs = doc.references.filter((reference) => reference.$refText === 'href');
      expect(hrefs).toHaveLength(2);
      for (const href of hrefs) {
        if (linked) expect(href.ref?.$container).toMatchObject({ $type: 'Data', name: 'Reference' });
        else expect(href.error?.message).toBe("Could not resolve reference to RosettaFeature named 'href'.");
      }
      expect(errors).not.toHaveBeenCalled();
    }
  );

  it('resolves feature scope through a cyclic alias and a concrete alternative', () => {
    const services = createRuneDslServices();
    const loop = { $type: 'RosettaSymbolReference', symbol: { $ref: '#/elements@1/shortcuts@0', $refText: 'loop' } };
    const [result] = hydrateModelDocuments(services, [
      {
        uri: 'file:///cycles.rosetta',
        json: JSON.stringify({
          $type: 'RosettaModel',
          name: 'cycles',
          imports: [],
          elements: [
            {
              $type: 'Data',
              name: 'Item',
              attributes: [
                {
                  $type: 'Attribute',
                  name: 'next',
                  typeCall: { $type: 'TypeCall', type: { $ref: '#/elements@0', $refText: 'Item' } }
                }
              ]
            },
            {
              $type: 'RosettaFunction',
              name: 'Cycle',
              shortcuts: [
                {
                  $type: 'ShortcutDeclaration',
                  name: 'loop',
                  expression: {
                    $type: 'DefaultOperation',
                    left: loop,
                    right: { $type: 'RosettaSymbolReference', symbol: { $ref: '#/elements@0', $refText: 'Item' } }
                  }
                }
              ],
              operations: [
                {
                  $type: 'Operation',
                  expression: {
                    $type: 'RosettaFeatureCall',
                    receiver: loop,
                    feature: { $refText: 'next', $error: 'pending' }
                  }
                }
              ]
            }
          ]
        })
      }
    ]);
    const func = result!.model.elements[1];
    if (!isRosettaFunction(func)) throw new Error('Expected function');
    const expression = func.operations[0]!.expression;
    if (!isRosettaFeatureCall(expression)) throw new Error('Expected feature call');
    const scope = services.RuneDsl.references.ScopeProvider.getScope({
      container: expression,
      property: 'feature',
      reference: expression.feature
    });
    expect(
      scope
        .getAllElements()
        .toArray()
        .map((element) => element.name)
    ).toContain('next');
  });

  const corpus = resolve(import.meta.dirname, '../../../../.resources/cdm');
  it.skipIf(!existsSync(corpus))(
    'links the real CDM corpus without overflowing inference',
    async () => {
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { shared } = createRuneDslServices();
      const files = [
        ...BASE_TYPE_FILES.map((f) => ({ uri: f.path, content: f.content })),
        ...readdirSync(corpus)
          .filter((f) => f.endsWith('.rosetta'))
          .map((f) => ({
            uri: `file:///cdm/${f}`,
            content: readFileSync(resolve(corpus, f), 'utf8')
          }))
      ];
      const docs = files.map((f) => shared.workspace.LangiumDocumentFactory.fromString(f.content, URI.parse(f.uri)));
      await shared.workspace.DocumentBuilder.build(docs, { validation: true });
      expect(errors.mock.calls.flat().map(String).join('\n')).not.toMatch(
        /Maximum call stack size|RangeError|Cyclic reference resolution/
      );
    },
    60_000
  );
});
