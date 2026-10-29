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

describe('qualified TypeScript function calls', () => {
  it.each(['per-namespace', 'barrel', 'single-file'] as const)(
    'keeps same-named declarations distinct in %s output',
    async (layout) => {
      const { RuneDsl } = createRuneDslServices();
      const sources = ['alpha', 'beta'].map(
        (namespace, index) => `namespace ${namespace}
func Echo:
 inputs: value int (1..1)
 output: result int (1..1)
 set result: value + ${index + 1}
func Zero:
 output: result int (1..1)
 set result: ${index + 1}
library function Custom(value int) int
reporting rule Read from int: item + ${index + 1}
`
      );
      sources[0] += '\ntype Entry:\n value int (1..1)\n';
      sources[0] += '\ntype rune:\n value int (1..1)\n';
      sources[1] +=
        '\nfunc rune:\n inputs:\n  a number (1..1)\n  b number (1..1)\n output: result boolean (1..1)\n set result: a = b\n';
      sources[0] += '\ntype Foo:\n alphaValue int (1..1)\n';
      sources[1] += '\ntype Foo:\n betaValue string (1..1)\n';
      for (let index = 0; index < 2; index++) {
        sources[index] += `
type Derived extends Foo:
 extra int (1..1)
typeAlias FooAlias: Foo
choice Selection:
 Foo
enum Side:
 ${index === 0 ? 'Alpha' : 'Beta'} displayName "${index === 0 ? 'Alpha' : 'Beta'}"
`;
      }
      sources[0] += `type Remote:
 amount int (1..1)
  [metadata scheme]
 link int (1..1)
  [metadata reference]
`;
      sources[1] += '\nfunc isEntry:\n inputs: value int (1..1)\n output: result int (1..1)\n set result: value + 3\n';
      sources[1] += `
func GetFloatingRateProcessingParameters:
 inputs: value int (1..1)
 output: result int (1..1)
 alias GetFloatingRateProcessingParameters: value + 100
 set result: if value = 0 then 4 else beta.GetFloatingRateProcessingParameters(value - 1) + 1
library function RemoteNative(value int) int
`;
      sources.push(`namespace caller
func ReadUnique:
 inputs: value int (1..1)
 output: result int (1..1)
 set result: beta.GetFloatingRateProcessingParameters(value)
func ShadowUnique:
 inputs: value int (1..1)
 output: result int (1..1)
 alias GetFloatingRateProcessingParameters: value + 100
 set result: beta.GetFloatingRateProcessingParameters(value)
func UniquePipeline:
 inputs: value int (1..1)
 output: result int (1..1)
 set result: value then beta.GetFloatingRateProcessingParameters
func UniqueChild extends beta.GetFloatingRateProcessingParameters:
 set result: super(value)
func CallUniqueNative:
 inputs: value int (1..1)
 output: result int (1..1)
 set result: beta.RemoteNative(value)
func ShadowLateNative:
 inputs: value int (1..1)
 output: result int (1..1)
 alias LateNative: value + 200
 set result: zeta.LateNative(value)
func CheckRuntimeNamespace:
 inputs:
  a alpha.rune (1..1)
  b alpha.rune (1..1)
 output: result boolean (1..1)
 alias rune: a
 alias rune_alias: b
 set result: rune = rune_alias
func CallRuntimeName:
 inputs:
  a number (1..1)
  b number (1..1)
 output: result boolean (1..1)
 set result: beta.rune(a, b)
func CheckInlineRuntimeName:
 inputs: xs number (0..*)
 output: result boolean (0..*)
 set result: xs extract rune [ rune = 1 ]
func KeepAlias:
 inputs: value alpha.FooAlias (1..1)
 output: result alpha.FooAlias (1..1)
 set result: value
func KeepChoice:
 inputs: value beta.Selection (1..1)
 output: result beta.Selection (1..1)
 set result: value
func KeepSide:
 inputs: value alpha.Side (1..1)
 output: result alpha.Side (1..1)
 set result: value
func ConvertFoo:
 inputs: value alpha.Foo (1..1)
 output: result beta.Foo (1..1)
 set result: beta.Foo {betaValue: "converted"}
func ConstructRemote:
 inputs: value int (1..1)
 output: result alpha.Remote (1..1)
 set result: alpha.Remote {amount: value, link: value}
func AssignRemote:
 inputs: value int (0..1)
 output: result alpha.Remote (1..1)
 set result -> amount: value
 set result -> link: value
func GuardName:
 inputs: value int (1..1)
 output: result int (1..1)
 set result: beta.isEntry(value)
func Echo:
 inputs: value int (1..1)
 output: result int (1..1)
 set result: alpha.Echo(value) + beta.Echo(value)
func Shadowed:
 inputs: value int (1..1)
 output: result int (1..1)
 alias Echo: value + 10
 alias __rune_alpha_Echo: value + 20
 set result: caller.Echo(value) + alpha.Echo(value)
func Both:
 inputs: value int (1..1)
 output: result int (1..1)
 set result: Echo(value)
func Constants:
 output: result int (1..1)
 set result: alpha.Zero + beta.Zero
func Pipeline:
 inputs: value int (1..1)
 output: result int (1..1)
 set result: value then alpha.Echo
func Child extends alpha.Echo:
 set result: super(value)
func Rules:
 inputs: value int (1..1)
 output: result int (1..1)
 set result: alpha.Read(value) + beta.Read(value)
func Libraries:
 inputs: value int (1..1)
 output: result int (1..1)
 set result: alpha.Custom(value) + beta.Custom(value)
`);
      sources.push(`namespace annotations
annotation rune:
 tagValue string (0..1)
type runeAnnotation:
 value int (1..1)
type runeAnnotation1Args:
 value int (1..1)
`);
      sources.push(`namespace observer
func ShadowAgain:
 inputs: value int (1..1)
 output: result int (1..1)
 alias GetFloatingRateProcessingParameters: value + 200
 set result: beta.GetFloatingRateProcessingParameters(value)
`);
      sources.push('namespace zeta\nlibrary function LateNative(value int) int\n');
      const docs = sources.map((source, index) =>
        RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
          source,
          URI.parse(`inmemory:///qualified-${index}.rosetta`)
        )
      );
      await RuneDsl.shared.workspace.DocumentBuilder.build(docs);
      expect(docs.flatMap((doc) => doc.parseResult.parserErrors)).toEqual([]);
      const outputs = await generate(docs, { target: 'typescript', typescript: { layout } });
      expect(outputs.flatMap((output) => output.diagnostics.filter((d) => d.severity === 'error'))).toEqual([]);
      const projection = outputs
        .flatMap((output) => output.projections ?? [])
        .find((entry) => /function ReadUnique\(/.test(entry.code));
      expect(projection?.body?.code).toContain('GetFloatingRateProcessingParameters(');
      expect(projection?.body?.code).not.toContain('__rune$');
      const directory = generatedDirectory(join(tmpdir(), 'rune-qualified-runtime-'));
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
          target: ts.ScriptTarget.ESNext,
          module: ts.ModuleKind.NodeNext,
          moduleResolution: ts.ModuleResolutionKind.NodeNext,
          skipLibCheck: true,
          types: []
        });
        expect(
          ts
            .getPreEmitDiagnostics(program)
            .map(
              (d) =>
                ts.flattenDiagnosticMessageText(d.messageText, '\n') +
                (d.file && d.start !== undefined
                  ? '\n' + d.file.text.split('\n')[d.file.getLineAndCharacterOfPosition(d.start).line]
                  : '')
            )
        ).toEqual([]);
        program.emit();
        const require = createRequire(join(directory, 'entry.js'));
        const entry = layout === 'single-file' ? 'model' : layout === 'barrel' ? 'index' : 'caller';
        const funcs = recordFunctionExports(require(`./${entry}.js`), outputs);
        expect(funcs.ReadUnique({ value: 4 })).toBe(8);
        expect(funcs.ShadowUnique({ value: 4 })).toBe(8);
        expect(funcs.UniquePipeline({ value: 4 })).toBe(8);
        expect(funcs.UniqueChild({ value: 4 })).toBe(8);
        const observer = layout === 'per-namespace' ? recordFunctionExports(require('./observer.js'), outputs) : funcs;
        expect(observer.ShadowAgain({ value: 4 })).toBe(8);
        const remoteNative = layout === 'per-namespace' ? require('./beta.js').RemoteNative : funcs.RemoteNative;
        remoteNative.implementation = (value: number) => value + 5;
        expect(funcs.CallUniqueNative({ value: 4 })).toBe(9);
        const lateNative = layout === 'per-namespace' ? require('./zeta.js').LateNative : funcs.LateNative;
        lateNative.implementation = (value: number) => value + 6;
        expect(funcs.ShadowLateNative({ value: 4 })).toBe(10);
        const annotations = layout === 'per-namespace' ? require('./annotations.js') : funcs;
        expect(typeof annotations.runeAnnotation2({ tagValue: 'test' })).toBe('function');
        expect(funcs.CheckRuntimeNamespace({ a: { value: 1 }, b: { value: 1 } })).toBe(true);
        expect(funcs.CheckRuntimeNamespace({ a: { value: 1 }, b: { value: 2 } })).toBe(false);
        expect(funcs.CallRuntimeName({ a: 1, b: 1 })).toBe(true);
        expect(funcs.CallRuntimeName({ a: 1, b: 2 })).toBe(false);
        expect(funcs.CheckInlineRuntimeName({ xs: [1, 2] })).toEqual([true, false]);
        const first = layout === 'per-namespace' ? require('./alpha.js').Custom : funcs.__rune$alpha$Custom;
        const second = layout === 'per-namespace' ? require('./beta.js').Custom : funcs.__rune$beta$Custom;
        first.implementation = (value: number) => value + 10;
        second.implementation = (value: number) => value + 20;
        expect(funcs.KeepAlias({ value: { alphaValue: 7 } })).toEqual({ alphaValue: 7 });
        expect(funcs.KeepChoice({ value: { foo: { betaValue: 'beta' } } })).toEqual({ foo: { betaValue: 'beta' } });
        expect(funcs.KeepSide({ value: 'Alpha' })).toBe('Alpha');
        const alphaDerived = layout === 'per-namespace' ? require('./alpha.js').Derived : funcs.__rune$alpha$Derived;
        const betaDerived = layout === 'per-namespace' ? require('./beta.js').Derived : funcs.__rune$beta$Derived;
        expect(alphaDerived.from({ alphaValue: 7, extra: 1 }).unwrap()).toMatchObject({ alphaValue: 7, extra: 1 });
        expect(betaDerived.from({ betaValue: 'beta', extra: 2 }).unwrap()).toMatchObject({
          betaValue: 'beta',
          extra: 2
        });
        expect(() => alphaDerived.from({ betaValue: 'beta', extra: 1 })).toThrow('alphaValue: expected 1..1');
        expect(funcs.ConvertFoo({ value: { alphaValue: 7 } })).toEqual({ betaValue: 'converted' });
        for (const name of ['ConstructRemote', 'AssignRemote']) {
          expect(funcs[name]({ value: 4 })).toEqual({ amount: { value: 4, meta: {} }, link: { value: 4 } });
        }
        expect(() => funcs.AssignRemote({})).toThrow('Cannot assign an absent value to a required field');
        expect(funcs.Both({ value: 4 })).toBe(11);
        expect(funcs.GuardName({ value: 4 })).toBe(7);
        expect(funcs.Shadowed({ value: 4 })).toBe(16);
        expect(funcs.Constants({})).toBe(3);
        expect(funcs.Pipeline({ value: 4 })).toBe(5);
        expect(funcs.Child({ value: 4 })).toBe(5);
        expect(funcs.Rules({ value: 4 })).toBe(11);
        expect(funcs.Libraries({ value: 4 })).toBe(38);
        if (layout !== 'per-namespace') {
          expect(layout === 'single-file' ? funcs.__rune$alpha$Echo({ value: 4 }) : funcs.__rune$alpha$Echo(4)).toBe(5);
          expect(layout === 'single-file' ? funcs.__rune$beta$Echo({ value: 4 }) : funcs.__rune$beta$Echo(4)).toBe(6);
          expect(layout === 'single-file' ? funcs.__rune$caller$Echo({ value: 4 }) : funcs.__rune$caller$Echo(4)).toBe(
            11
          );
        }
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
    30_000
  );
});
