// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { expect, it } from 'vitest';
import { assertValidDocuments, BASICTYPES_ROSETTA, createRuneDslServices } from '@rune-langium/core';
import { URI } from 'langium';
import { generate } from '../../src/export.js';
import { compileGeneratedTypeScript } from '../helpers/compiled-typescript.js';

const source = `namespace mappedJson
 type Entry:
  amount number (1..1)
  pattern pattern (1..1)
  date date (1..1)
  condition Positive: amount > 0
`;
const checks = `
export function mappedJSON() {
  const row = { amount: 2, pattern: /^a+$/, date: Temporal.PlainDate.from('2026-11-05') };
  const values = Entry.from([row, row]);
  const mapped = values.map(item => item);
  const nested = values.flatMap(item => [{ copy: { pattern: item.pattern, date: item.date } }]);
  return {
    original: JSON.parse(JSON.stringify(values)),
    mapped: JSON.parse(JSON.stringify(mapped)),
    patterns: JSON.parse(JSON.stringify(values.map(item => item.pattern))),
    depthZero: JSON.parse(JSON.stringify(values.map(item => [[item.amount]]).flat(0))),
    depthOne: JSON.parse(JSON.stringify(values.map(item => [[item.amount]]).flat())),
    depthTwo: JSON.parse(JSON.stringify(values.map(item => [[item.amount]]).flat(2))),
    depthInfinite: JSON.parse(JSON.stringify(values.map(item => [[[item.amount]]]).flat(Infinity))),
    depthNegative: JSON.parse(JSON.stringify(values.map(item => [[item.amount]]).flat(-1))),
    flatMethods: values.map(item => [[item.amount]]).flat(2).sum(),
    nested: JSON.parse(JSON.stringify(nested)),
    single: JSON.parse(JSON.stringify(values.filter((_item, index) => index === 0).map(item => item.pattern))),
    empty: JSON.parse(JSON.stringify(values.filter(() => false).map(item => item.pattern))),
    wire: Reflect.apply(Reflect.get(mapped, 'toJSON'), mapped, [{ format: 'RUNE_JSON' }])
  };
}
export function invalidMapped() {
  const row = { amount: 2, pattern: /^a+$/, date: Temporal.PlainDate.from('2026-11-05') };
  const values = Entry.from([row, row]);
  values[0].amount = -1;
  return JSON.stringify(values.map(item => item));
}
export function flaggedMapped() {
  const row = { amount: 2, pattern: /a/i, date: Temporal.PlainDate.from('2026-11-05') };
  return JSON.stringify(Entry.from([row, row]).map(item => ({ nested: item.pattern })));
}
export function cyclicMapped() {
  const row = { amount: 2, pattern: /a/, date: Temporal.PlainDate.from('2026-11-05') };
  const cycle: { self?: unknown } = {};
  cycle.self = cycle;
  return JSON.stringify(Entry.from([row, row]).map(() => cycle));
}
`;

for (const serialization of ['native', 'zod'] as const) {
  it.each(['per-namespace', 'barrel', 'single-file'] as const)(
    `preserves native JSON values in mapped projected arrays (${serialization}, %s)`,
    async (layout) => {
      const { RuneDsl } = createRuneDslServices();
      const docs = [BASICTYPES_ROSETTA, source].map((text, index) =>
        RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
          text,
          URI.parse(`inmemory:///mapped-${index}.rosetta`)
        )
      );
      await RuneDsl.shared.workspace.DocumentBuilder.build(docs);
      assertValidDocuments(docs);
      const outputs = await generate(docs, {
        target: 'typescript',
        typescript: { layout, ...(serialization === 'zod' ? { serialization } : {}) }
      });
      const entry = outputs.find((output) => output.content.includes('export class Entry '))!;
      const api = compileGeneratedTypeScript<{
        mappedJSON(): Record<string, unknown>;
        invalidMapped(): unknown;
        flaggedMapped(): unknown;
        cyclicMapped(): unknown;
      }>(
        outputs.map((output) => (output === entry ? { ...output, content: output.content + checks } : output)),
        {
          entry: entry.relativePath
        }
      );
      const plain = { amount: 2, pattern: '^a+$', date: '2026-11-05' };
      expect(api.mappedJSON()).toEqual({
        original: [plain, plain],
        mapped: [plain, plain],
        patterns: ['^a+$', '^a+$'],
        depthZero: [[[2]], [[2]]],
        depthOne: [[2], [2]],
        depthTwo: [2, 2],
        depthInfinite: [2, 2],
        depthNegative: [[[2]], [[2]]],
        flatMethods: 4,
        single: ['^a+$'],
        empty: [],
        nested: [{ copy: { pattern: '^a+$', date: plain.date } }, { copy: { pattern: '^a+$', date: plain.date } }],
        wire: [
          { '@type': 'mappedJson.Entry', ...plain },
          { '@type': 'mappedJson.Entry', ...plain }
        ]
      });
      if (serialization === 'zod') expect(() => api.invalidMapped()).toThrow();
      expect(() => api.flaggedMapped()).toThrow(/flags/);
      expect(() => api.cyclicMapped()).toThrow(/cyclic/);
    }
  );
}
