// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { compileGeneratedTypeScript } from '../helpers/compiled-typescript.js';
import { describe, it, expect } from 'vitest';
import { parseExpression, isData, isRosettaModel } from '@rune-langium/core';
import { transpileExpression, type ExpressionTranspilerContext } from '../../src/expr/transpiler.js';
import { RUNTIME_HELPER_JS_SOURCE } from '../../src/helpers.js';
import ts from 'typescript-classic';
import { writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { linkedFunctions } from './python-test-utils.js';
import { generatedDirectory } from '../helpers/generated-directory.js';
import { AstUtils } from 'langium';
import { generate } from '../../src/export.js';

const context: ExpressionTranspilerContext = {
  selfName: 'data',
  emitMode: 'ts-expression',
  typeName: 'Test',
  conditionName: 'rule',
  attributeTypes: new Map(),
  diagnostics: []
};
function render(text: string) {
  const parsed = parseExpression(text);
  expect(parsed.hasErrors).toBe(false);
  return transpileExpression(parsed.value, context);
}
function evaluate(text: string, data: unknown = {}) {
  const code = ts.transpileModule('const result = (' + render(text) + ');', {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText;
  return new Function('data', RUNTIME_HELPER_JS_SOURCE + '\n' + code + '\nreturn result;')(data);
}

describe('native operators in the canonical emitter', () => {
  it('keeps required fields of the current validated Data record native', async () => {
    const [func] = await linkedFunctions(`namespace native.data
 type Value:
  amount int (1..1)
  condition Increment: amount + 1 > amount
 func Anchor:
  output: result int (1..1)
  set result: 1
`);
    const model = AstUtils.getDocument(func!).parseResult.value;
    if (!isRosettaModel(model)) throw new Error('Expected a model');
    const data = model.elements.find(isData)!;
    const expression = transpileExpression(data.conditions[0]!.expression!, context);
    expect(expression).not.toContain('rune.binary');
    expect(expression).not.toContain('rune.compare');
    expect(new Function('data', `return ${expression};`)({ amount: 2 })).toBe(true);
  });

  it('lifts required outputs and aliases because declaration cardinality does not prove initialization', async () => {
    const [func] = await linkedFunctions(`namespace native.initialization
func RequiredOutput:
 inputs: flag boolean (1..1)
 output: result number (1..1)
 alias pending: result
 set result: if flag then 1
 set result: result + 1
 set result: pending + 1
`);
    for (const operation of func!.operations.slice(1)) {
      const expression = transpileExpression(operation.expression, {
        ...context,
        localBindings: new Map([
          ['result', 'result'],
          ['pending', 'pending']
        ])
      });
      expect(expression).not.toContain('rune.binary');
      const javascript = ts.transpileModule(
        `function run(result: unknown, pending: unknown) { return ${expression}; }`,
        { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
      ).outputText;
      expect(
        new Function(
          'result',
          'pending',
          RUNTIME_HELPER_JS_SOURCE + '\n' + javascript + '\nreturn run(result, pending);'
        )(undefined, undefined)
      ).toBeUndefined();
    }
  });
  it('rejects an absent final result rather than returning NaN from emitted TypeScript', async () => {
    const [func] = await linkedFunctions(`namespace native.initialization
func RequiredOutput:
 inputs: flag boolean (1..1)
 output: result number (1..1)
 set result: if flag then 1
 set result: result + 1
`);
    const files = await generate([AstUtils.getDocument(func!)], {
      target: 'typescript',
      typescript: { layout: 'single-file' }
    });
    const exports = compileGeneratedTypeScript(files);
    expect(exports.RequiredOutput!(true)).toBe(2);
    expect(() => exports.RequiredOutput!(false)).toThrow("Function 'RequiredOutput' produced no result");
  });
  it('uses strict scalar equality and direct numeric comparisons', () => {
    expect(render('"a" = "b"')).toBe('false');
    expect(render('True <> False')).toBe('true');
    expect(render('1 < 2')).toBe('(1 < 2)');
    expect(render('1 + 2')).toBe('(1 + 2)');
    expect(evaluate('1 + 2 * 3')).toBe(7);
    expect(evaluate('(1 + 2) * 3')).toBe(9);
    expect(evaluate('empty exists')).toBe(false);
    expect(evaluate('empty is absent')).toBe(true);
  });
  it('guards optional primitive comparisons and evaluates function operands once', async () => {
    const [maybe, check] = await linkedFunctions(`namespace native.nullable
func Maybe:
 inputs: flag boolean (1..1)
 output: result number (0..1)
 set result: if flag then 1
func Check:
 inputs: flag boolean (1..1) left number (0..1) right number (0..1)
 output: result boolean (1..1)
 set result: left > right
 set result: Maybe(flag) > 0
`);
    expect(maybe).toBeDefined();
    const predicates = check!.operations.map((operation) => transpileExpression(operation.expression, context));
    expect(predicates[0]).toBe('(data.left != null && data.right != null && data.left > data.right)');
    for (const predicate of predicates) expect(predicate).not.toMatch(/\bas\b|rune\.compare/);
    const compare = new Function('data', `return ${predicates[0]};`);
    expect(compare({ left: 2, right: 1 })).toBe(true);
    expect(compare({ left: 2 })).toBe(false);
    expect(compare({ right: 1 })).toBe(false);
    let calls = 0;
    const run = new Function('data', 'Maybe', `return ${predicates[1]};`);
    expect(
      run({ flag: false }, () => {
        calls++;
        return undefined;
      })
    ).toBe(false);
    expect(calls).toBe(1);
  });
  it('emits required boolean and scalar-presence conditions without casts or helpers', async () => {
    const [func] = await linkedFunctions(`namespace native.conditions
type OtherAgreementTerms:
 isSpecified boolean (1..1)
 legalDocument string (0..1)
 condition NotSpecified: if isSpecified = False then legalDocument is absent
 condition Specified: if isSpecified = True then legalDocument exists
func Anchor:
 output: result boolean (1..1)
 set result: True
`);
    const model = AstUtils.getDocument(func!).parseResult.value;
    if (!isRosettaModel(model)) throw new Error('Expected a model');
    const data = model.elements.find(isData)!;
    const predicates = data.conditions.map((condition) => transpileExpression(condition.expression!, context));
    expect(predicates).toEqual([
      '(!data.isSpecified ? data.legalDocument == null : false)',
      '(data.isSpecified ? data.legalDocument != null : false)'
    ]);
    const absent = new Function('data', `return ${predicates[0]};`);
    expect(absent({ isSpecified: false })).toBe(true);
    expect(absent({ isSpecified: false, legalDocument: '' })).toBe(false);
    expect(absent({ isSpecified: true })).toBe(false);
    const files = await generate([AstUtils.getDocument(func!)], { target: 'typescript' });
    const exports = compileGeneratedTypeScript<Record<string, unknown>>(files);
    const Terms = exports.OtherAgreementTerms as new (data: { isSpecified: boolean; legalDocument?: string }) => {
      validateNotSpecified(): { valid: boolean };
      validateSpecified(): { valid: boolean };
    };
    for (const value of [{ isSpecified: false }, { isSpecified: true, legalDocument: 'signed' }]) {
      const terms = new Terms(value);
      expect(terms.validateNotSpecified().valid).toBe(true);
      expect(terms.validateSpecified().valid).toBe(true);
    }
  });
  it('uses enum values and metadata cardinality directly in linked Data predicates', async () => {
    const [func] = await linkedFunctions(`namespace native.agreements
annotation metadata:
 scheme string (0..1)
 reference string (0..1)
enum AgreementType:
 Other
 MasterAgreement
 MasterConfirmation
 Confirmation
type AgreementName:
 agreementType AgreementType (1..1)
 otherAgreement string (0..1)
 masterAgreementType AgreementType (0..1) [metadata scheme]
 contractualDefinitionsType AgreementType (0..*) [metadata scheme]
 references AgreementType (0..*) [metadata reference]
 condition Other: if agreementType <> AgreementType -> Other then otherAgreement is absent
 condition Master: if agreementType = AgreementType -> MasterAgreement then masterAgreementType exists
 condition Definitions: contractualDefinitionsType is absent
 condition References: references exists
 condition Contradictory: agreementType <> AgreementType -> Other or agreementType <> AgreementType -> MasterAgreement
 condition Nested: if agreementType <> AgreementType -> Other then otherAgreement is absent
   else if agreementType <> AgreementType -> MasterAgreement then masterAgreementType is absent
   else if agreementType <> AgreementType -> MasterConfirmation then contractualDefinitionsType is absent
func Anchor:
 output: result boolean (1..1)
 set result: True
func BareEnum:
 output: result AgreementType (1..1)
 set result: Other
`);
    const model = AstUtils.getDocument(func!).parseResult.value;
    if (!isRosettaModel(model)) throw new Error('Expected a model');
    const data = model.elements.find(isData)!;
    const predicates = data.conditions.map((condition) => transpileExpression(condition.expression!, context));
    for (const predicate of predicates) expect(predicate).not.toMatch(/\bas\b|rune\.(valueKey|exists|compare)/);
    expect(predicates[0]).toContain('data.agreementType !== "Other"');
    expect(predicates[1]).toContain('data.masterAgreementType?.value != null');
    expect(predicates[2]).toBe('!data.contractualDefinitionsType?.length');
    expect(predicates[3]).toContain('.some(');
    const execute = (index: number, value: unknown) => new Function('data', `return ${predicates[index]};`)(value);
    expect(execute(2, {})).toBe(true);
    expect(execute(2, { contractualDefinitionsType: [] })).toBe(true);
    expect(execute(2, { contractualDefinitionsType: [{ value: 'Other', meta: {} }] })).toBe(false);
    expect(execute(3, { references: [{ externalReference: 'unresolved' }] })).toBe(false);
    expect(execute(3, { references: [{ value: 'Other' }] })).toBe(true);
    expect(execute(4, { agreementType: 'Other' })).toBe(true);
    expect(execute(5, { agreementType: 'Other' })).toBe(true);
    expect(execute(5, { agreementType: 'Other', masterAgreementType: { value: 'MasterAgreement', meta: {} } })).toBe(
      false
    );
    const files = await generate([AstUtils.getDocument(func!)], { target: 'typescript' });
    expect(files[0]!.content).toContain('return "Other";');
    const directory = generatedDirectory(join(tmpdir(), 'rune-native-enums-'));
    try {
      const filename = join(directory, 'case.ts');
      writeFileSync(
        filename,
        `type AgreementType = "Other" | "MasterAgreement" | "MasterConfirmation" | "Confirmation";
type Input = {agreementType: AgreementType; otherAgreement?: string;
 masterAgreementType?: {value: AgreementType; meta: object};
 contractualDefinitionsType?: {value: AgreementType; meta: object}[];
 references?: {value?: AgreementType; externalReference?: string}[]};
${predicates.map((predicate, index) => `function case${index}(data: Input) { return ${predicate}; }`).join('\n')}`
      );
      const compile = spawnSync(
        'pnpm',
        ['exec', 'tsc', '--ignoreConfig', '--strict', '--noEmit', '--skipLibCheck', '--target', 'ESNext', filename],
        { encoding: 'utf8' }
      );
      expect(compile.status, compile.stdout + compile.stderr).toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it('retains collection and unresolved structured value semantics', () => {
    expect(evaluate('[1, 2] = [1, 2]')).toBe(true);
    expect(evaluate('[1, 2] = [2, 1]')).toBe(false);
    expect(evaluate('a = b', { a: { value: 1 }, b: { value: 1 } })).toBe(true);
    expect(evaluate('a = b', { a: undefined, b: null })).toBe(true);
    expect(render('a = b')).toBe('(rune.valueKey(data.a) === rune.valueKey(data.b))');
    expect(render('[1, 2] = [1, 2]')).not.toContain('rune.');
    expect(evaluate('[1, 2] = [1, 2]')).toBe(true);
  });
  it('strictly compiles native equality after nested boolean control-flow narrowing', async () => {
    const [func] = await linkedFunctions(`namespace native.narrowing
func Check:
 inputs: flag boolean (1..1)
 output: result boolean (1..1)
 set result: if flag = False then (if flag = True then False else True) else True
`);
    const expression = transpileExpression(func!.operations[0]!.expression, {
      ...context,
      attributeTypes: new Map([['flag', 'boolean']])
    });
    const directory = generatedDirectory(join(tmpdir(), 'rune-native-equality-'));
    try {
      const filename = join(directory, 'case.ts');
      const source = `function execute(data: {flag: boolean}) { return ${expression}; }`;
      writeFileSync(filename, source);
      const compile = spawnSync(
        'pnpm',
        ['exec', 'tsc', '--ignoreConfig', '--strict', '--noEmit', '--skipLibCheck', '--target', 'ESNext', filename],
        { encoding: 'utf8' }
      );
      expect(compile.status, compile.stdout + compile.stderr).toBe(0);
      const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
      const run = new Function('data', javascript + '\nreturn execute(data);');
      expect(run({ flag: false })).toBe(true);
      expect(run({ flag: true })).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
