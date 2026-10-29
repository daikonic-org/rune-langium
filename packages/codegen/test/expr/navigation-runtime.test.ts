// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, expect, it } from 'vitest';
import {
  createRuneDslServices,
  isData,
  isRosettaFunction,
  isRosettaFeatureCall,
  isRosettaDeepFeatureCall,
  isRosettaImplicitVariable,
  isRosettaModel,
  isRosettaSymbolReference,
  type RosettaExpression
} from '@rune-langium/core';
import { URI } from 'langium';
import { RUNTIME_HELPER_SOURCE } from '../../src/helpers.js';
import { createRequire } from 'node:module';
import ts from 'typescript-classic';
import { deepFeaturePaths, featureName, expressionIsMany, renderNavigation } from '../../src/expr/navigation.js';

const SOURCE = `namespace test.navigation
type Child:
  value int (1..1)
type Parent:
  children Child (0..*)
type EconomicTerms:
  marker string (1..1)
type Product:
  economicTerms EconomicTerms (1..1)
type Underlier:
  product Product (1..1)
func Collect:
  inputs:
    parent Parent (1..1)
  output:
    result int (0..*)
  set result: parent -> children -> value
func FilterChildren:
  inputs:
    parent Parent (1..1)
  output:
    result Child (0..*)
  set result: parent -> children filter [item -> value = 1]
func MapValues:
  inputs:
    parent Parent (1..1)
  output:
    result int (0..*)
  set result: parent -> children extract [item -> value]
func FindTerms:
  inputs:
    underlier Underlier (1..1)
  output:
    result EconomicTerms (0..1)
  set result: underlier ->> economicTerms
`;

function renderExpression(expression: RosettaExpression): string {
  if (isRosettaImplicitVariable(expression)) return 'input';
  if (isRosettaSymbolReference(expression)) {
    const name = expression.symbol?.$refText ?? '?';
    return `input[${JSON.stringify(name)}]`;
  }
  if (isRosettaFeatureCall(expression) || isRosettaDeepFeatureCall(expression)) {
    return renderNavigation(expression, renderExpression) ?? 'undefined';
  }
  return 'undefined';
}

async function parseFunctions() {
  const { RuneDsl } = createRuneDslServices();
  const document = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
    SOURCE,
    URI.parse('inmemory:///navigation-runtime.rosetta')
  );
  await RuneDsl.shared.workspace.DocumentBuilder.build([document]);
  expect(document.parseResult.parserErrors).toEqual([]);
  const model = document.parseResult.value;
  if (!isRosettaModel(model)) throw new Error('expected a RosettaModel');
  return model.elements.filter((element) => element.$type === 'RosettaFunction');
}

function compile(source: string, functionName: string): (input: Record<string, unknown>) => unknown {
  source = RUNTIME_HELPER_SOURCE + '\n' + source;
  const fileName = new URL('./generated-navigation.ts', import.meta.url).pathname;
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
  host.readFile = (file) => (file === fileName ? source : readFile(file));
  const program = ts.createProgram([fileName], options, host);
  expect(ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual(
    []
  );
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.CommonJS }
  }).outputText;
  const exports: Record<string, (input: Record<string, unknown>) => unknown> = {};
  new Function('exports', 'require', js)(exports, createRequire(import.meta.url));
  return exports[functionName]!;
}

function functionSource(
  functionNode: { name: string; operations: Array<{ expression: RosettaExpression }> },
  resultType: string
): string {
  const expression = renderExpression(functionNode.operations[0]!.expression);
  if (functionNode.name === 'Collect') {
    return `type ChildShape = { value: number }; type ParentShape = { children: ChildShape[] }; export function Collect(input: { parent: ParentShape }): ${resultType} { return ${expression}; }`;
  }
  return `type EconomicTermsShape = { marker: string }; type ProductShape = { economicTerms: EconomicTermsShape }; type UnderlierShape = { product: ProductShape }; export function FindTerms(input: { underlier: UnderlierShape }): ${resultType} { return ${expression}; }`;
}

describe('linked navigation runtime rendering', () => {
  it.each(['alpha', 'beta'].flatMap((namespace) => [false, true].map((many) => ({ namespace, many }))))(
    'projects only the linked $namespace feature (many=$many)',
    async ({ namespace, many }) => {
      const { RuneDsl } = createRuneDslServices();
      const sources = ['alpha', 'beta'].map(
        (name) => `namespace ${name}
type Foo:
 ${name}Value string (1..1)
typeAlias FooAlias: Foo
type Leaf:
 value FooAlias (0..1)`
      );
      sources.push(`namespace caller
type Root:
 left alpha.Leaf (0..${many ? '*' : '1'})
 right beta.Leaf (0..${many ? '*' : '1'})
func Read:
 inputs: source Root (1..1)
 output: result ${namespace}.Foo (0..${many ? '*' : '1'})
 set result: source ->> value`);
      const docs = sources.map((source, index) =>
        RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
          source,
          URI.parse(`inmemory:///deep-identity-${index}.rosetta`)
        )
      );
      await RuneDsl.shared.workspace.DocumentBuilder.build(docs);
      expect(docs.flatMap((doc) => doc.parseResult.parserErrors)).toEqual([]);
      const targetModel = docs[namespace === 'alpha' ? 0 : 1]!.parseResult.value;
      const caller = docs[2]!.parseResult.value;
      if (!isRosettaModel(targetModel) || !isRosettaModel(caller)) throw new Error('expected Rune models');
      const leaf = targetModel.elements.filter(isData).find((node) => node.name === 'Leaf')!;
      const source = caller.elements.find(isData)!;
      const func = caller.elements.find(isRosettaFunction)!;
      const expression = func.operations[0]!.expression;
      if (!isRosettaDeepFeatureCall(expression)) throw new Error('expected deep navigation');
      const target = leaf.attributes[0]!;
      const linked = { ...expression, feature: { ...expression.feature, $refText: target.name, ref: target } };
      const side = namespace === 'alpha' ? 'left' : 'right';
      expect(deepFeaturePaths(source, 'value', new Set(), target).map((path) => path.map(featureName))).toEqual([
        [side, 'value']
      ]);
      const read = compile(
        `
type Alpha = { alphaValue: string };
type Beta = { betaValue: string };
export function Read(input: { source: { left?: { value?: Alpha }${many ? '[]' : ''}; right?: { value?: Beta }${many ? '[]' : ''} } }): ${namespace === 'alpha' ? 'Alpha' : 'Beta'}${many ? '[]' : ' | undefined'} {
 return ${renderExpression(linked)};
}`,
        'Read'
      );
      const alpha = { alphaValue: 'alpha' };
      const beta = { betaValue: 'beta' };
      const container = (value: unknown) => (many ? [{ value }] : { value });
      expect(read({ source: { left: container(alpha), right: container(beta) } })).toEqual(
        many ? [namespace === 'alpha' ? alpha : beta] : namespace === 'alpha' ? alpha : beta
      );
      expect(read({ source: namespace === 'alpha' ? { right: container(beta) } : { left: container(alpha) } })).toEqual(
        many ? [] : undefined
      );
    }
  );

  it('reports collection cardinality for navigation and higher-order operations', async () => {
    const functions = await parseFunctions();
    expect(expressionIsMany(functions.find((func) => func.name === 'Collect')!.operations[0]!.expression)).toBe(true);
    expect(expressionIsMany(functions.find((func) => func.name === 'FilterChildren')!.operations[0]!.expression)).toBe(
      true
    );
    expect(expressionIsMany(functions.find((func) => func.name === 'MapValues')!.operations[0]!.expression)).toBe(true);
  });

  it('maps and flattens a navigation through an array-valued feature', async () => {
    const functions = await parseFunctions();
    const node = functions.find((func) => func.name === 'Collect')!;
    const collect = compile(functionSource(node, 'number[]'), 'Collect');
    expect(collect({ parent: { children: [{ value: 1 }, { value: 2 }] } })).toEqual([1, 2]);
    expect(collect({ parent: { children: [] } })).toEqual([]);
  });

  it('resolves a deep target through a valid multi-hop Data path', async () => {
    const functions = await parseFunctions();
    const node = functions.find((func) => func.name === 'FindTerms')!;
    const findTerms = compile(functionSource(node, 'EconomicTermsShape | undefined'), 'FindTerms');
    expect(findTerms({ underlier: { product: { economicTerms: { marker: 'ok' } } } })).toEqual({ marker: 'ok' });
    expect(findTerms({ underlier: { product: {} } })).toBeUndefined();
  });
});
