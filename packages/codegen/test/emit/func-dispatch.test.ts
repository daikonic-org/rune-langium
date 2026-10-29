// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { RUNTIME_HELPER_SOURCE } from '../../src/helpers.js';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { createRuneDslServices, isRosettaModel } from '@rune-langium/core';
import { URI } from 'langium';
import ts from 'typescript-classic';
import { extractFuncs, type FuncBodyContext, type RuneFunc } from '../../src/types/func.js';
import { renderFuncAssignment } from '../../src/emit/func-assignment.js';
import { renderFuncDispatchGroup, renderFuncDispatches } from '../../src/emit/func-dispatch.js';
import { transpileCondition, transpileExpression } from '../../src/expr/transpiler.js';

const SOURCE = `namespace test.dispatch
enum Kind:
  Cash
  Credit
func Compute:
  inputs:
    kind Kind (1..1)
    amount int (1..1)
  output:
    result int (1..1)
  condition AmountPositive:
    amount > 0
  set result: amount
  post-condition: result >= 0
func Compute(kind: Kind -> Cash):
  condition AmountPositive:
    amount > 0
  set result: amount + 1
  post-condition: result >= 0
func Compute(kind: Kind -> Credit):
  condition AmountPositive:
    amount > 0
  set result: amount + 2
  post-condition: result >= 0
`;

type DispatchFunc = RuneFunc & { dispatchAttribute?: string; dispatchValue?: string };

async function parseDispatchFuncs(): Promise<DispatchFunc[]> {
  const { RuneDsl } = createRuneDslServices();
  const doc = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
    SOURCE,
    URI.parse('inmemory:///func-dispatch.rosetta')
  );
  await RuneDsl.shared.workspace.DocumentBuilder.build([doc]);
  expect(doc.parseResult.parserErrors).toEqual([]);
  const model = doc.parseResult.value;
  if (!isRosettaModel(model)) throw new Error('expected a RosettaModel');

  const diagnostics: never[] = [];
  const extracted = extractFuncs([doc], 'test.dispatch', diagnostics);
  const astFunctions = model.elements.filter((element) => element.$type === 'RosettaFunction');
  return extracted.map((func, index) => {
    const node = astFunctions[index]!;
    return {
      ...func,
      dispatchAttribute: node.dispatchAttribute?.$refText,
      dispatchValue: node.dispatchValue?.value?.$refText
    };
  });
}

function renderParsedBody(func: DispatchFunc): string[] {
  const ctx: FuncBodyContext = {
    selfName: 'input',
    emitMode: 'ts-expression',
    conditionName: func.name,
    typeName: func.name,
    attributeTypes: new Map([
      ['kind', 'Kind'],
      ['amount', 'number'],
      ['result', 'number']
    ]),
    diagnostics: [],
    localBindings: new Map([
      ['kind', 'input.kind'],
      ['amount', 'input.amount'],
      ['result', 'result']
    ]),
    currentFunc: func,
    outputAccumulator: 'scalar',
    aliasBindings: new Map(),
    callGraph: new Map()
  };
  const assignment = func.assignments[0];
  if (!assignment) throw new Error(`expected assignment in ${func.name}`);
  const renderCondition = (condition: unknown): string[] => {
    const conditionNode = condition as { name?: string };
    const conditionContext = {
      ...ctx,
      emitMode: 'ts-method' as const,
      conditionName: conditionNode.name ?? func.name
    };
    return transpileCondition(condition as never, conditionContext)
      .replace(/errors\.push\('(.+?)'\);/g, `throw new Error('Diagnostic: $1');`)
      .split('\n');
  };
  return [
    'let result: number;',
    ...func.preConditions.flatMap(renderCondition),
    ...renderFuncAssignment(assignment, ctx, (expr) => transpileExpression(expr as never, ctx)),
    ...func.postConditions.flatMap(renderCondition),
    'return result;'
  ];
}

function execute(code: string): Record<string, (input: Record<string, unknown>) => unknown> {
  code = RUNTIME_HELPER_SOURCE + '\n' + code;
  const fileName = new URL('./generated-dispatch.ts', import.meta.url).pathname;
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.CommonJS,
    skipLibCheck: true,
    types: []
  };
  const host = ts.createCompilerHost(options);
  const readFile = host.readFile.bind(host);
  host.readFile = (file) => (file === fileName ? code : readFile(file));
  const program = ts.createProgram([fileName], options, host);
  expect(ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual(
    []
  );
  const js = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.CommonJS }
  }).outputText;
  const exports: Record<string, (input: Record<string, unknown>) => unknown> = {};
  new Function('exports', 'require', js)(exports, createRequire(import.meta.url));
  return exports;
}

describe('Rune function dispatch emission', () => {
  it('parses real dispatch overloads, emits one switch with a base fallback, and executes each body', async () => {
    const funcs = await parseDispatchFuncs();
    expect(funcs.map((func) => [func.name, func.dispatchAttribute, func.dispatchValue])).toEqual([
      ['Compute', undefined, undefined],
      ['Compute', 'kind', 'Cash'],
      ['Compute', 'kind', 'Credit']
    ]);

    const code = renderFuncDispatchGroup(funcs, {
      renderSignature: () => `export function Compute(input: { kind: 'Cash' | 'Credit'; amount: number }): number`,
      renderBody: renderParsedBody
    });
    expect(code.match(/export function Compute/g)).toHaveLength(1);
    expect(code).toContain('switch (input["kind"])');
    expect(code).toContain('default:');

    const compute = execute(code).Compute!;
    expect(compute({ kind: 'Cash', amount: 10 })).toBe(11);
    expect(compute({ kind: 'Credit', amount: 10 })).toBe(12);
    expect(compute({ kind: 'Unknown', amount: 10 })).toBe(10);
    expect(() => compute({ kind: 'Cash', amount: -1 })).toThrow(
      'Diagnostic: AmountPositive: condition failed in Compute'
    );
    expect(() => compute({ kind: 'Unknown', amount: -1 })).toThrow(
      'Diagnostic: AmountPositive: condition failed in Compute'
    );
  });

  it('renders ordinary functions through the same API and rejects ambiguous groups', () => {
    const ordinary = { name: 'Identity' };
    expect(
      renderFuncDispatches([ordinary], {
        renderSignature: () => 'export function Identity(input: number): number',
        renderBody: () => ['return input;']
      })
    ).toEqual(['export function Identity(input: number): number {\n  {\n    return input;\n  }\n}']);

    expect(() =>
      renderFuncDispatchGroup(
        [
          { name: 'Bad', dispatchAttribute: 'kind', dispatchValue: 'Cash' },
          { name: 'Bad', dispatchAttribute: 'kind', dispatchValue: 'Cash' }
        ],
        { renderSignature: () => 'export function Bad(input: unknown): unknown', renderBody: () => ['return input;'] }
      )
    ).toThrow('has no base declaration');

    expect(() =>
      renderFuncDispatchGroup(
        [
          { name: 'Bad', dispatchAttribute: 'kind', dispatchValue: 'Cash' },
          { name: 'Bad', dispatchAttribute: 'mode', dispatchValue: 'Credit' },
          { name: 'Bad' }
        ],
        { renderSignature: () => 'export function Bad(input: unknown): unknown', renderBody: () => ['return input;'] }
      )
    ).toThrow('uses more than one dispatch attribute');
  });
});
