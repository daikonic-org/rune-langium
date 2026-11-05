// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { expect, it } from 'vitest';
import { assertValidDocuments, BASICTYPES_ROSETTA, createRuneDslServices } from '@rune-langium/core';
import { URI } from 'langium';
import { generate } from '../../src/export.js';
import { compileGeneratedTypeScript } from '../helpers/compiled-typescript.js';

for (const serialization of ['runtime', 'zod'] as const)
  it.each(['per-namespace', 'barrel', 'single-file', 'inline'] as const)(
    `distinguishes authored RegExp from native patterns with ${serialization} serialization (%s)`,
    async (layout) => {
      const { RuneDsl } = createRuneDslServices();
      const docs = [
        BASICTYPES_ROSETTA,
        `namespace patternNames
type RegExp:
 value number (1..1)
type Holder:
 expression pattern (1..1)
func Echo:
 inputs: expression pattern (1..1)
 output: result pattern (1..1)
 set result: expression
`
      ].map((text, index) =>
        RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
          text,
          URI.parse(`inmemory:///pattern-names-${index}.rosetta`)
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
      const model = outputs.find((output) => output.content.includes('export class RegExp '))!;
      const api = compileGeneratedTypeScript<{
        RegExp: { from(value: unknown): { value: number } };
        Holder: {
          from(value: unknown): { expression: RegExp; toJSON(): unknown };
          fromJSON(value: unknown): { expression: RegExp; toJSON(): unknown };
        };
        Echo(value: RegExp): RegExp;
      }>(outputs, { entry: model.relativePath });
      expect(api.RegExp.from({ value: 3 }).value).toBe(3);
      const decoded = api.Holder.fromJSON({ expression: '^x+$' });
      expect(decoded.expression).toBeInstanceOf(RegExp);
      expect(decoded.expression.test('xxx')).toBe(true);
      expect(decoded.toJSON()).toEqual({ expression: '^x+$' });
      expect(api.Holder.from({ expression: /x/ }).expression).toBeInstanceOf(RegExp);
      expect(api.Echo(/x/).test('x')).toBe(true);
    }
  );
