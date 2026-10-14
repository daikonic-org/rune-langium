// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import ts from 'typescript-classic';
import { AstUtils } from 'langium';
import { expect, it } from 'vitest';
import { generate } from '../../src/export.js';
import { generatePythonModule } from '../../src/projection/python-functions.js';
import { linkedFunctions, runPython } from '../projection/python-test-utils.js';

const source = `namespace positional.api
func Ordered:
 inputs: ^first number (0..1) second number (1..1) suffix string (0..1)
 output: answer number (1..1)
 set answer: if ^first exists then ^first + second else second
func Forward:
 output: answer number (1..1)
 set answer: Ordered(empty, 7, empty)
func Zero:
 output: answer number (1..1)
 set answer: 9
func Count:
 inputs: len number (1..1) values number (0..*)
 output: answer number (1..1)
 set answer: len + values count
func Shadow:
 inputs: result number (1..1) Ordered number (1..1)
 output: answer number (1..1)
 set answer: positional.api.Ordered(result, Ordered, empty)
func Escaped:
 inputs: ^class number (1..1) ^from number (1..1)
 output: answer number (1..1)
 set answer: ^class + ^from
func AwaitValue:
 inputs: await number (1..1)
 output: answer number (1..1)
 set answer: await
func class_input:
 inputs: amount number (1..1)
 output: answer number (1..1)
 set answer: amount + 1
func SynthesizedShadow:
 inputs: seed number (1..1) ^class number (1..1)
 output: answer number (1..1)
 set answer: class_input(^class)
`;

function assertModuleSyntax(code: string) {
  const result = spawnSync(process.execPath, ['--input-type=module', '--check'], {
    input: ts.transpileModule(code, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
    }).outputText,
    encoding: 'utf8'
  });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
}

it('escapes module and strict-mode reserved parameter bindings', async () => {
  const names = ['await', 'yield', 'arguments', 'eval'];
  const funcs = await linkedFunctions(
    'namespace positional.reserved\n' +
      names
        .map(
          (name, index) =>
            `func Reserved${index}:\n inputs: ^${name} number (1..1)\n output: answer number (1..1)\n set answer: ^${name}\n`
        )
        .join('\n')
  );
  const outputs = await generate([AstUtils.getDocument(funcs[0]!)], {
    target: 'typescript',
    typescript: { layout: 'single-file' }
  });
  const code = outputs[0]!.content;
  for (const [index, name] of names.entries())
    expect(code).toContain(`function Reserved${index}(${name}_input: number)`);
  assertModuleSyntax(code);
});

it('exports strictly typed positional TypeScript APIs with Rune parameter order and names', async () => {
  const funcs = await linkedFunctions(source);
  const outputs = await generate([AstUtils.getDocument(funcs[0]!)], {
    target: 'typescript',
    typescript: { layout: 'single-file' }
  });
  const code = outputs[0]!.content;
  expect(code).toContain('function Ordered(first: number | undefined, second: number, suffix?: string)');
  expect(outputs[0]!.funcs.find((func) => func.name === 'Ordered')?.parameterNames).toEqual([
    'first',
    'second',
    'suffix'
  ]);
  const assertions = `
const value: number = Ordered(undefined, 7);
const zero: number = Zero();
const count: number = Count(1, [2, 3]);
// @ts-expect-error Required second parameter cannot be omitted.
Ordered();
// @ts-expect-error Input records are not the public function ABI.
Ordered({first: 1, second: 2});
// @ts-expect-error Preserve each parameter's type.
Ordered(1, 'wrong');
`;
  const filename = resolve(import.meta.dirname, 'generated-positional-api.ts');
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    types: []
  };
  const host = ts.createCompilerHost(options),
    readFile = host.readFile.bind(host);
  host.readFile = (path) => (path === filename ? code + assertions : readFile(path));
  expect(
    ts
      .getPreEmitDiagnostics(ts.createProgram([filename], options, host))
      .map((error) => ts.flattenDiagnosticMessageText(error.messageText, '\n'))
  ).toEqual([]);
  assertModuleSyntax(code);
  const javascript = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  const exports: Record<string, (...args: unknown[]) => unknown> = {};
  new Function('exports', 'require', javascript)(exports, createRequire(import.meta.url));
  expect(exports.Ordered!(undefined, 7)).toBe(7);
  expect(exports.Ordered!(3, 7, 'suffix')).toBe(10);
  expect(exports.Forward!()).toBe(7);
  expect(exports.Zero!()).toBe(9);
  expect(exports.Shadow!(3, 7)).toBe(10);
  expect(exports.Count!(1, [2, 3])).toBe(3);
  expect(exports.Escaped!(3, 7)).toBe(10);
  expect(exports.AwaitValue!(3)).toBe(3);
  expect(exports.SynthesizedShadow!(0, 3)).toBe(4);
});

it('exports positional Python APIs and preserves builtins and callable bindings shadowed by input names', async () => {
  const funcs = await linkedFunctions(source);
  const module = generatePythonModule([AstUtils.getDocument(funcs[0]!)]);
  expect(module.code).toContain('def Ordered(first: float | None, second: float, suffix: str | None = None)');
  expect(module.code).toContain('def Count(len: float, values: list[float] | None = None)');
  expect(module.code).toContain('_rune_builtins.len(');
  expect(
    runPython(
      [
        { expression: 'Ordered(None, 7)' },
        { expression: 'Ordered(3, 7, "suffix")' },
        { expression: 'Forward()' },
        { expression: 'Zero()' },
        { expression: 'Shadow(3, 7)' },
        { expression: 'Count(1, [2, 3])' },
        { expression: 'Escaped(3, 7)' },
        { expression: 'AwaitValue(3)' },
        { expression: 'SynthesizedShadow(0, 3)' },
        { expression: 'Ordered(3, 7, "the literal len(values) stays unchanged")' }
      ],
      module.code.replace(/^from __future__.*$/gm, '')
    )
  ).toEqual([7, 10, 7, 9, 10, 3, 10, 3, 4, 10].map((value) => ({ value })));
});
