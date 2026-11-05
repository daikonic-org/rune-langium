// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { expect, it } from 'vitest';
import { assertValidDocuments, BASICTYPES_ROSETTA, createRuneDslServices } from '@rune-langium/core';
import { URI } from 'langium';
import { generate } from '../../src/export.js';
import { compileGeneratedTypeScript } from '../helpers/compiled-typescript.js';

interface Tree {
  value: number;
  next?: Tree;
  peer?: Tree;
  toJSON(): unknown;
}
interface Factory {
  new (value: unknown): Tree;
  create(constructor: Factory): (value: unknown) => Tree;
  from(value: unknown): Tree;
  fromJSON(value: unknown): Tree;
}

for (const serialization of ['runtime', 'zod'] as const)
  it.each(['per-namespace', 'barrel', 'single-file', 'inline'] as const)(
    `validates recursive construction linearly with ${serialization} serialization (%s)`,
    async (layout) => {
      const { RuneDsl } = createRuneDslServices();
      const docs = [
        BASICTYPES_ROSETTA,
        `namespace construction
type Node:
 value number (1..1)
 next Node (0..1)
 peer Node (0..1)
 condition Positive: value > 0
`,
        `namespace constructionLeaf
import construction.*
type Leaf extends Node:
 note string (0..1)
`
      ].map((text, index) =>
        RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
          text,
          URI.parse(`inmemory:///construction-${index}.rosetta`)
        )
      );
      await RuneDsl.shared.workspace.DocumentBuilder.build(docs);
      assertValidDocuments(docs);
      const outputs = await generate(docs, {
        target: 'typescript',
        typescript: {
          serialization,
          ...(layout === 'inline' ? { inlineHelpers: true } : { layout })
        }
      });
      const model = outputs.find((output) => output.content.includes('export class Node '))!;
      const foreign = outputs.find((output) => output.content.includes('export class Leaf '))!;
      const api = compileGeneratedTypeScript<{ Node: Factory; Leaf: Factory }>(
        outputs.map((output) =>
          output === model && foreign !== model
            ? { ...output, content: `${output.content}\nexport { Leaf } from './constructionLeaf.js';` }
            : output
        ),
        { entry: model.relativePath }
      );
      const getter = Reflect.get(api.Node, Symbol.for('rune-langium.object.definition'));
      if (typeof getter !== 'function') throw Error('Missing Node definition');
      const definition: unknown = Reflect.apply(getter, api.Node, []);
      if (!definition || typeof definition !== 'object') throw Error('Missing Node descriptor');
      const fields: unknown = Reflect.get(definition, 'fields');
      if (!fields || typeof fields !== 'object') throw Error('Missing Node fields');
      const field: unknown = Reflect.get(fields, 'value');
      if (!field || typeof field !== 'object') throw Error('Missing value field');
      const original: unknown = Reflect.get(field, 'check');
      if (typeof original !== 'function') throw Error('Missing primitive check');
      let checks = 0;
      let permitted = true;
      let failAt: number | undefined;
      let denied: number | undefined;
      Reflect.set(field, 'check', (value: unknown) => {
        checks++;
        if (checks === failAt) throw new Error('Constructor check failed');
        return permitted && value !== denied && Reflect.apply(original, undefined, [value]);
      });
      const chain = (depth: number, tagged = false) => {
        let input: { value: number; next?: unknown } | undefined;
        for (let index = 0; index < depth; index++)
          input = {
            value: index + 1,
            ...(tagged ? { '@type': 'constructionLeaf.Leaf' } : {}),
            ...(input ? { next: input } : {})
          };
        return input;
      };
      for (const factory of [api.Node, api.Leaf])
        for (const depth of [32, 64, 128]) {
          const input = chain(depth, factory === api.Leaf);
          checks = 0;
          const created = factory.from(input);
          expect(checks).toBeLessThanOrEqual(4 * depth);
          checks = 0;
          const decoded = factory.fromJSON(input);
          expect(checks).toBeLessThanOrEqual(8 * depth);
          for (const root of [created, decoded, new factory(input)]) {
            checks = 0;
            let visited = 0;
            for (let node: Tree | undefined = root; node; node = node.next) visited++;
            expect(visited).toBe(depth);
            expect(checks).toBeLessThanOrEqual(4 * depth);
            if (root === created || root === decoded) expect(checks).toBe(0);
          }
          expect(created.toJSON()).toEqual(input);
          expect(decoded.toJSON()).toEqual(input);
        }
      expect(() => api.Node.from({ value: 1, next: { value: 'bad' } })).toThrow();
      if (serialization === 'zod') {
        expect(() => api.Leaf.fromJSON({ value: -1 })).toThrow();
        expect(() => api.Leaf.fromJSON({ value: 1, next: { value: -1 } })).toThrow();
      }
      const shared = { value: 1 };
      const repeated = api.Node.from({ value: 1, next: shared, peer: shared });
      expect(repeated.next).toBe(repeated.peer);
      const created = api.Node.from(chain(4));
      const child = created.next;
      permitted = false;
      expect(() => api.Node.from(created)).toThrow();
      expect(() => {
        created.next = child;
      }).toThrow();
      permitted = true;
      expect(() => Reflect.set(created, 'value', 'bad')).toThrow();
      const raw = { value: 2 };
      const direct = new api.Node({ value: 1, next: raw });
      Reflect.set(raw, 'value', 'bad');
      expect(() => direct.next).toThrow();
      const input = { value: 1, next: { value: 2 } };
      checks = 0;
      failAt = 3;
      expect(() => api.Node.create(api.Node)(input)).toThrow('Constructor check failed');
      failAt = undefined;
      denied = 2;
      expect(() => new api.Node(input)).toThrow();
      denied = undefined;
      const cyclic: { value: number; next?: unknown } = { value: 1 };
      cyclic.next = cyclic;
      const view = api.Node.from(cyclic);
      expect(view.next).toBe(view);
    }
  );
