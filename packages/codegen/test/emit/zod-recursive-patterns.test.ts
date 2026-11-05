// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { expect, it } from 'vitest';
import { assertValidDocuments, BASICTYPES_ROSETTA, createRuneDslServices } from '@rune-langium/core';
import { URI } from 'langium';
import { generate } from '../../src/export.js';
import { compileGeneratedTypeScript } from '../helpers/compiled-typescript.js';

const source = `namespace recursivePatterns
typeAlias Expression: pattern
type Node:
 direct pattern (1..1)
 aliased Expression (1..1)
 alternatives pattern (0..*)
 next Node (0..1)
`;

type Schema = { parse(value: unknown): unknown; encode(value: unknown): unknown };

it.each(
  [false, true].flatMap((codecs) =>
    (['per-namespace', 'barrel', 'single-file'] as const).map((layout) => ({ codecs, layout }))
  )
)(
  'keeps recursive pattern outputs consistent with Zod schemas ($layout, codecs: $codecs)',
  async ({ codecs, layout }) => {
    const { RuneDsl } = createRuneDslServices();
    const docs = [BASICTYPES_ROSETTA, source].map((text, index) =>
      RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
        text,
        URI.parse(`inmemory:///recursive-patterns-${index}.rosetta`)
      )
    );
    await RuneDsl.shared.workspace.DocumentBuilder.build(docs);
    assertValidDocuments(docs);
    const outputs = await generate(docs, { target: 'zod', zod: { codecs, layout } });
    const model = outputs.find((output) => output.content.includes('export interface Node '))!;
    const api = compileGeneratedTypeScript<{ NodeSchema: Schema; NodeCodec: Schema }>(outputs, {
      entry: model.relativePath,
      assertions: `
const output = NodeSchema.parse({ direct: '^a+$', aliased: '^b$', alternatives: [] });
const direct: ${codecs ? 'RegExp' : 'string'} = output.direct;
const alias: ${codecs ? 'RegExp' : 'string'} = output.aliased;
const alternatives: ${codecs ? 'RegExp' : 'string'}[] | undefined = output.alternatives;
// @ts-expect-error wire strings and native patterns are distinct representations
const wrong: ${codecs ? 'string' : 'RegExp'} = output.direct;
`
    });
    const wire = {
      direct: '^a+$',
      aliased: '^b$',
      alternatives: ['^c$'],
      next: { direct: '^d$', aliased: '^e$', alternatives: [] }
    };
    if (!codecs) {
      expect(api.NodeSchema.parse(wire)).toEqual(wire);
      expect(() => api.NodeSchema.parse({ ...wire, direct: /a/ })).toThrow();
      expect(() => api.NodeSchema.parse({ ...wire, next: { ...wire.next, aliased: /e/ } })).toThrow();
      return;
    }
    const native = {
      direct: /^a+$/,
      aliased: /^b$/,
      alternatives: [/^c$/],
      next: { direct: /^d$/, aliased: /^e$/, alternatives: [] }
    };
    expect(api.NodeSchema.parse(wire)).toEqual(native);
    expect(api.NodeCodec.encode(api.NodeCodec.parse(wire))).toEqual(wire);
    expect(api.NodeCodec.encode(native)).toEqual(wire);
    expect(() => api.NodeCodec.encode(wire)).toThrow();
    expect(() => api.NodeCodec.parse({ ...wire, next: { ...wire.next, direct: '[' } })).toThrow();
    expect(() => api.NodeCodec.encode({ ...native, next: { ...native.next, direct: /^d$/i } })).toThrow(/flags/);
  }
);
