// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { expect, it } from 'vitest';
import { assertValidDocuments, BASICTYPES_ROSETTA, createRuneDslServices } from '@rune-langium/core';
import { URI } from 'langium';
import { generate } from '../../src/export.js';
import { compileGeneratedTypeScript } from '../helpers/compiled-typescript.js';

const source = `namespace choiceRoundtrip
type FlatArray:
 value number (1..1)
type Item:
 amount number (1..1)
 pattern pattern (1..1)
choice Pick:
 Item
type Container:
 pick Pick (1..1)
 picks Pick (0..*)
`;

for (const serialization of ['native', 'zod'] as const)
  it.each(['per-namespace', 'barrel', 'single-file', 'inline'] as const)(
    `round-trips structural Choice JSON separately from Rune JSON (${serialization}, %s)`,
    async (layout) => {
      const { RuneDsl } = createRuneDslServices();
      const docs = [BASICTYPES_ROSETTA, source].map((text, index) =>
        RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
          text,
          URI.parse(`inmemory:///choice-${index}.rosetta`)
        )
      );
      await RuneDsl.shared.workspace.DocumentBuilder.build(docs);
      assertValidDocuments(docs);
      const outputs = await generate(docs, {
        target: 'typescript',
        typescript: {
          ...(layout === 'inline' ? { inlineHelpers: true } : { layout }),
          ...(serialization === 'zod' ? { serialization } : {})
        }
      });
      const entry = outputs.find((output) => output.content.includes('export class Container '))!;
      type Value = { toJSON(options?: { format: 'RUNE_JSON' }): unknown };
      const api = compileGeneratedTypeScript<
        Record<
          'Container' | 'Pick',
          {
            fromJSON(value: unknown, options?: { format: 'RUNE_JSON' }): Value;
          }
        >
      >(outputs, { entry: entry.relativePath });
      const item = { amount: 3, pattern: '^x+$' };
      const plain = { pick: { item }, picks: [{ item }, { item }] };
      const value = api.Container.fromJSON(plain);
      expect(value.toJSON()).toEqual(plain);
      expect(JSON.parse(JSON.stringify(value))).toEqual(plain);
      expect(api.Container.fromJSON(value.toJSON()).toJSON()).toEqual(plain);
      expect(api.Pick.fromJSON({ item }).toJSON()).toEqual({ item });
      const wire = {
        '@type': 'choiceRoundtrip.Container',
        pick: { '@type': 'choiceRoundtrip.Item', ...item },
        picks: [
          { '@type': 'choiceRoundtrip.Item', ...item },
          { '@type': 'choiceRoundtrip.Item', ...item }
        ]
      };
      expect(value.toJSON({ format: 'RUNE_JSON' })).toEqual(wire);
      expect(api.Container.fromJSON(wire, { format: 'RUNE_JSON' }).toJSON({ format: 'RUNE_JSON' })).toEqual(wire);
    }
  );
