// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { generatedDirectory } from '../helpers/generated-directory.js';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { recordFunctionExports } from '../helpers/record-function-exports.js';
import { describe, expect, it } from 'vitest';
import { createRuneDslServices } from '@rune-langium/core';
import { URI } from 'langium';
import ts from 'typescript-classic';
import { generate } from '../../src/export.js';

async function compile(source: string, assertions: string): Promise<Record<string, (input: unknown) => unknown>> {
  const { RuneDsl } = createRuneDslServices();
  const doc = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
    source,
    URI.parse('inmemory:///function-data-types.rosetta')
  );
  await RuneDsl.shared.workspace.DocumentBuilder.build([doc]);
  expect(doc.parseResult.parserErrors).toHaveLength(0);

  const outputs = await generate(doc, { target: 'typescript' });
  expect(
    outputs.flatMap((output) => output.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'))
  ).toEqual([]);
  const code = outputs[0]!.content;
  const fileName = new URL('./generated-function-data-types.ts', import.meta.url).pathname;
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    skipLibCheck: true,
    types: []
  };
  const host = ts.createCompilerHost(options);
  const readFile = host.readFile.bind(host);
  host.readFile = (file) => (file === fileName ? `${code}\n${assertions}` : readFile(file));
  const program = ts.createProgram([fileName], options, host);
  expect(
    ts.getPreEmitDiagnostics(program).map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
  ).toEqual([]);

  const js = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  const exports: Record<string, (input: unknown) => unknown> = {};
  new Function('exports', 'require', js)(exports, createRequire(import.meta.url));
  return recordFunctionExports(exports, outputs);
}

async function parse(source: string, uri: string) {
  const { RuneDsl } = createRuneDslServices();
  const doc = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(source, URI.parse(uri));
  await RuneDsl.shared.workspace.DocumentBuilder.build([doc]);
  expect(doc.parseResult.parserErrors).toHaveLength(0);
  return doc;
}

describe('plain-data TypeScript function boundaries', () => {
  it('accepts nested constructor payloads for Data with conditions and returns plain data', async () => {
    const funcs = await compile(
      `namespace test.functionDataTypes
type Child:
  value int (1..1)
  condition Positive:
    value > 0
type Parent:
  child Child (1..1)
  condition ChildPositive:
    child -> value > 0
reporting rule ReadChild from Parent:
  child
library function CopyParent(source Parent) Parent
func LibraryEcho:
  inputs: source Parent (1..1)
  output: result Parent (1..1)
  set result: CopyParent(source)
func RuleRead:
  inputs: source Parent (1..1)
  output: result Child (1..1)
  set result: ReadChild(source)
type RefTarget:
  value string (1..1)
func Build:
  inputs:
    value int (1..1)
  output:
    result Parent (1..1)
  set result:
    Parent { child: Child { value: value } }
func Echo:
  inputs:
    value Parent (1..1)
  output:
    result Parent (1..1)
  set result:
    value
func BuildPath:
  inputs: value int (1..1)
  output: result Parent (1..1)
  set result -> child -> value: value
func RefCall:
  inputs:
    source RefTarget (1..1)
      [metadata reference]
  output:
    result RefTarget (1..1)
      [metadata reference]
  set result: RefEcho(source)
func RefEcho:
  inputs:
    source RefTarget (1..1)
      [metadata reference]
  output:
    result RefTarget (1..1)
      [metadata reference]
  set result:
    source
func RefRaw:
  inputs:
    text string (1..1)
  output:
    result RefTarget (1..1)
      [metadata reference]
  set result:
    RefTarget { value: text }
`,
      `
const input: RuneFuncData<ParentShape> = { child: { value: 4 } };
const output: RuneFuncData<ParentShape> = Build(4);
const echoed: RuneFuncData<ParentShape> = Echo(input);
const referenceInput: RuneReferenceWithMeta<RuneFuncData<RefTargetShape>> = { value: { value: 'A' } };
const echoedReference: RuneReferenceWithMeta<RuneFuncData<RefTargetShape>> = RefEcho(referenceInput);
const rawReference: RuneReferenceWithMeta<RuneFuncData<RefTargetShape>> = RefRaw('A');
// @ts-expect-error Child's required value must remain present in nested plain data.
const missingChildValue: RuneFuncData<ParentShape> = { child: {} };
// @ts-expect-error Build's scalar input remains numeric.
Build('wrong');
`
    );

    expect(funcs.Build!({ value: 4 })).toEqual({ child: { value: 4 } });
    expect(funcs.BuildPath!({ value: 6 })).toEqual({ child: { value: 6 } });
    Object.assign(funcs.CopyParent!, { implementation: (value: unknown) => value });
    expect(funcs.LibraryEcho!({ source: { child: { value: 7 } } })).toEqual({ child: { value: 7 } });
    expect(funcs.RuleRead!({ source: { child: { value: 8 } } })).toEqual({ value: 8 });
    expect(funcs.Echo!({ value: { child: { value: 5 } } })).toEqual({ child: { value: 5 } });
    const referenceInput = { value: { value: 'A' } };
    expect(funcs.RefEcho!({ source: referenceInput })).toBe(referenceInput);
    expect(funcs.RefCall!({ source: referenceInput })).toBe(referenceInput);
    expect(funcs.RefRaw!({ text: 'A' })).toEqual({ value: { value: 'A' } });
  });

  it.each(['per-namespace', 'barrel', 'single-file'] as const)(
    'compiles data, alias, and inherited metadata boundaries in %s layout',
    async (layout) => {
      const { RuneDsl } = createRuneDslServices();
      const sources = [
        `namespace typed.models
type Child:
 value int (1..1)
 condition Positive: value > 0
type Parent:
 child Child (1..1)
typeAlias ParentAlias: Parent
func Read:
 inputs:
  source Parent (1..1)
   [metadata reference]
 output: result int (1..1)
 set result: source -> child -> value
func MetaEcho:
 inputs:
  source Parent (1..1)
   [metadata scheme]
 output:
  result Parent (1..1)
   [metadata scheme]
 set result: source
`,
        `namespace typed.functions
import typed.models.*
func Echo:
 inputs: source ParentAlias (1..1)
 output: result ParentAlias (1..1)
 set result: source
func Build:
 inputs: value int (1..1)
 output: result Parent (1..1)
 set result: Parent {child: Child {value: value}}
`,
        `namespace typed.inherited
import typed.models.*
func InheritedRead extends Read:
 set result: source -> child -> value
func InheritedEcho extends MetaEcho:
 set result: super(source)
`,
        `namespace typed.bridge
import typed.models.*
func ReadValue:
 inputs: value int (1..1)
 output: result int (1..1)
 set result: Read(Parent {child: Child {value: value}})
`
      ];
      const docs = sources.map((source, index) =>
        RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
          source,
          URI.parse(`inmemory:///typed-${index}.rosetta`)
        )
      );
      await RuneDsl.shared.workspace.DocumentBuilder.build(docs);
      expect(docs.flatMap((doc) => doc.parseResult.parserErrors)).toEqual([]);
      const outputs = await generate(docs, { target: 'typescript', typescript: { layout } });
      expect(outputs.flatMap((out) => out.diagnostics.filter((d) => d.severity === 'error'))).toEqual([]);
      const directory = generatedDirectory(join(tmpdir(), 'rune-function-types-'));
      try {
        const files = outputs.map((output) => {
          const path = join(directory, output.relativePath);
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, output.content);
          return path;
        });
        const program = ts.createProgram(files, {
          strict: true,
          noEmit: true,
          target: ts.ScriptTarget.ES2022,
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
                '\n' +
                (d.file && d.start !== undefined
                  ? d.file.text.split('\n')[d.file.getLineAndCharacterOfPosition(d.start).line]
                  : '')
            )
        ).toEqual([]);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  );

  it('keeps the recursive helper single in a bundled multi-namespace module', async () => {
    const docs = await Promise.all([
      parse(
        `namespace test.functionDataTypes.one
type One:
  value int (1..1)
func MakeOne:
  inputs:
    value int (1..1)
  output:
    result One (1..1)
  set result: One { value: value }
`,
        'inmemory:///function-data-types-one.rosetta'
      ),
      parse(
        `namespace test.functionDataTypes.two
type Two:
  value int (1..1)
func MakeTwo:
  inputs:
    value int (1..1)
  output:
    result Two (1..1)
  set result: Two { value: value }
`,
        'inmemory:///function-data-types-two.rosetta'
      )
    ]);
    const outputs = await generate(docs, { target: 'typescript', typescript: { layout: 'single-file' } });
    const model = outputs.find((output) => output.relativePath === 'model.ts');
    expect(model).toBeDefined();
    expect(model!.content.match(/type RuneFuncData<T>/g)).toHaveLength(1);
  });
});
