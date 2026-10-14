// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { generatedDirectory } from '../helpers/generated-directory.js';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { recordFunctionExports } from '../helpers/record-function-exports.js';
import { describe, expect, it } from 'vitest';
import { createRuneDslServices } from '@rune-langium/core';
import { URI } from 'langium';
import ts from 'typescript-classic';
import { generate } from '../../src/export.js';

describe('TypeScript library function runtime', () => {
  it.each(['per-namespace', 'barrel', 'single-file'] as const)(
    'executes built-ins across namespaces in %s layout',
    async (layout) => {
      const { RuneDsl } = createRuneDslServices();
      const sources = [
        `namespace builtin.helpers
library function Min(left number, right number) number
library function Max(left number, right number) number
library function IsLeapYear(year int) boolean
library function Custom(value int) int
`,
        `namespace builtin.consumer
import builtin.helpers.*
func Minimum:
 inputs:
  left number (1..1)
  right number (1..1)
 output: result number (1..1)
 set result: Min(left, right)
func Maximum:
 inputs:
  left number (1..1)
  right number (1..1)
 output: result number (1..1)
 set result: Max(left, right)
func LeapYear:
 inputs: year int (1..1)
 output: result boolean (1..1)
 set result: IsLeapYear(year)
func External:
 inputs: value int (1..1)
 output: result int (1..1)
 set result: Custom(value)
`
      ];
      const docs = sources.map((source, index) =>
        RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
          source,
          URI.parse(`inmemory:///library-${index}.rosetta`)
        )
      );
      await RuneDsl.shared.workspace.DocumentBuilder.build(docs);
      expect(docs.flatMap((doc) => doc.parseResult.parserErrors)).toEqual([]);
      const outputs = await generate(docs, { target: 'typescript', typescript: { layout } });
      expect(outputs.flatMap((output) => output.diagnostics.filter((d) => d.severity === 'error'))).toEqual([]);
      const directory = generatedDirectory(join(tmpdir(), 'rune-library-runtime-'));
      try {
        writeFileSync(join(directory, 'package.json'), '{"type":"commonjs"}');
        const files = outputs.map((output) => {
          const path = join(directory, output.relativePath);
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, output.content);
          return path;
        });
        const program = ts.createProgram(files, {
          strict: true,
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.NodeNext,
          moduleResolution: ts.ModuleResolutionKind.NodeNext,
          skipLibCheck: true,
          types: []
        });
        expect(
          ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
        ).toEqual([]);
        program.emit();
        const require = createRequire(join(directory, 'entry.js'));
        const entry = layout === 'single-file' ? 'model' : layout === 'barrel' ? 'index' : 'builtin/consumer';
        const funcs = recordFunctionExports(require(`./${entry}.js`), outputs);
        const library = layout === 'per-namespace' ? require('./builtin/helpers.js') : funcs;
        expect(funcs.Minimum({ left: 4, right: -2 })).toBe(-2);
        expect(funcs.Maximum({ left: 4, right: -2 })).toBe(4);
        for (const [year, expected] of [
          [1900, false],
          [2000, true],
          [2024, true],
          [2023, false]
        ]) {
          expect(funcs.LeapYear({ year })).toBe(expected);
        }
        expect(() => funcs.External({ value: 3 })).toThrow("Library function 'Custom' requires an implementation");
        library.Custom.implementation = (value: number) => value + 1;
        expect(funcs.External({ value: 3 })).toBe(4);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  );
});
