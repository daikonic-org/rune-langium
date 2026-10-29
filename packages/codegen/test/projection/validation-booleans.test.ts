// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { beforeAll, describe, expect, it } from 'vitest';
import { AstUtils, URI, type AstNode } from 'langium';
import { createRuneDslServices, getNodeSourceRegion, isData, isRosettaFunction } from '@rune-langium/core';
import { generate, selectTypeScriptProjection } from '../../src/export.js';
import { generatePythonModule, selectPythonProjection } from '../../src/projection/python-functions.js';
import { compileGeneratedTypeScript } from '../helpers/compiled-typescript.js';
import { referenceFiles } from '../helpers/cdm-reference.js';
import { linkedFunctions, runPython } from './python-test-utils.js';

const source = `namespace test.validation
type Amount:
 value number (1..1)
 condition Positive: value > 0
func ValidateAmount:
 inputs: amount number (1..1)
 output: result number (1..1)
 alias limit: 10
 condition Positive: amount > 0
 set result: amount
 post-condition WithinLimit: result <= limit
func ValidateFlag:
 inputs: flag boolean (1..1)
 output: result boolean (1..1)
 condition Enabled: flag = True
 set result: flag
`;

describe('validation failures in displayed bodies', () => {
  let outputs: Awaited<ReturnType<typeof generate>>;
  let python: ReturnType<typeof generatePythonModule>;
  let funcs: Awaited<ReturnType<typeof linkedFunctions>>;
  let document: ReturnType<typeof AstUtils.getDocument>;
  beforeAll(async () => {
    funcs = await linkedFunctions(source);
    document = AstUtils.getDocument(funcs[0]!);
    outputs = await generate([document], { target: 'typescript' });
    python = generatePythonModule([document]);
  });

  function body(node: AstNode, kind: 'function' | 'condition', language: 'typescript' | 'python') {
    const subject = { uri: document.uri.toString(), nodeId: node.$type, region: getNodeSourceRegion(node) };
    return language === 'typescript'
      ? selectTypeScriptProjection(outputs, subject, kind, 'body').code
      : selectPythonProjection(python, subject, kind, 'body').code;
  }

  it('shows authored assertions in their original phases', () => {
    const display = body(funcs[0]!, 'function', 'typescript');
    expect(display).toContain('assert(amount > 0, "Positive");');
    expect(display).toContain('assert(result <= limit, "WithinLimit");');
    expect(display.indexOf('assert(amount')).toBeLessThan(display.indexOf('const result'));
    expect(display.indexOf('assert(result')).toBeGreaterThan(display.indexOf('const result'));
    expect(display).not.toContain('return false;');
    expect(body(funcs[1]!, 'function', 'typescript')).toContain('assert(flag == true, "Enabled")');
  });

  it('returns False for failed Python preconditions and postconditions, retaining successful values', () => {
    const display = body(funcs[0]!, 'function', 'python');
    expect(display).not.toContain('raise');
    expect(display.match(/return False/g)).toHaveLength(2);
    const code = `def projected(amount):\n${display
      .split('\n')
      .map((line) => '    ' + line)
      .join('\n')}\n`;
    const flag = body(funcs[1]!, 'function', 'python');
    const flagCode = `def projected_flag(flag):\n${flag
      .split('\n')
      .map((line) => '    ' + line)
      .join('\n')}\n`;
    expect(
      runPython(
        [-1, 5, 20].map((amount) => ({ expression: `projected(${amount})` })),
        code
      )
    ).toEqual([{ value: false }, { value: 5 }, { value: false }]);
    expect(
      runPython([{ expression: 'projected_flag(False)' }, { expression: 'projected_flag(True)' }], flagCode)
    ).toEqual([{ value: false }, { value: true }]);
  });

  it.each(['typescript', 'python'] as const)('keeps %s condition bodies as plain predicates', (language) => {
    const data = [...AstUtils.streamAst(document.parseResult.value)].find(isData)!;
    for (const condition of [data.conditions[0]!, funcs[0]!.conditions[0]!, funcs[0]!.postConditions[0]!]) {
      const predicate = body(condition.expression, 'condition', language);
      expect(predicate).not.toMatch(/throw|raise|errors\.push|return/);
    }
  });

  it('preserves diagnostic failures in executable TypeScript and Python APIs', () => {
    const runtime = compileGeneratedTypeScript<{ ValidateAmount: (amount: number) => number }>(outputs);
    expect(runtime.ValidateAmount(5)).toBe(5);
    expect(() => runtime.ValidateAmount(-1)).toThrow(/Positive/);
    expect(() => runtime.ValidateAmount(20)).toThrow(/WithinLimit/);
    const results = runPython(
      [-1, 5, 20].map((amount) => ({ expression: `ValidateAmount(${amount})` })),
      python.code,
      { includeRuntime: false }
    );
    expect(results[0]).toEqual({ error: 'Diagnostic: Positive' });
    expect(results[1]).toEqual({ value: 5 });
    expect(results[2]).toEqual({ error: 'Diagnostic: WithinLimit' });
  });

  // This integration check links the corpus and emits both languages under coverage.
  it('returns false before the native implementation in the pinned CDM RoundToNearest example', async () => {
    const { RuneDsl } = createRuneDslServices();
    const documents = referenceFiles().map(({ uri, content }) =>
      RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(content, URI.parse(uri))
    );
    await RuneDsl.shared.workspace.DocumentBuilder.build(documents, { validation: false });
    const func = documents
      .flatMap((doc) => [...AstUtils.streamAst(doc.parseResult.value)])
      .find((node) => isRosettaFunction(node) && node.name === 'RoundToNearest')!;
    const subject = {
      uri: AstUtils.getDocument(func).uri.toString(),
      nodeId: 'RoundToNearest',
      region: getNodeSourceRegion(func)
    };
    const generated = await generate(documents, { target: 'typescript' });
    const projection = selectTypeScriptProjection(generated, subject, 'function', 'body');
    expect(projection.code).toContain('assert(');
    expect(projection.code).not.toContain('not_implemented');
    expect(projection.implementation?.status).toBe('unavailable');
    const pyBody = selectPythonProjection(generatePythonModule(documents), subject, 'function', 'body').code;
    const code = `def projected(nearest):\n${pyBody
      .split('\n')
      .map((line) => '    ' + line)
      .join('\n')}\n`;
    expect(runPython([{ expression: 'projected(-1)' }], code)).toEqual([{ value: false }]);
    expect(pyBody).toContain('rune.native');
  }, 30_000);
});
