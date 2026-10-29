// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, expect, it } from 'vitest';
import { URI } from 'langium';
import { BASICTYPES_ROSETTA, createRuneDslServices } from '@rune-langium/core';
import { extractFuncs } from '../../src/types/func.js';
import { renderSourceTypeScriptFunction } from '../../src/projection/source-typescript-function.js';

async function project(body: string) {
  const { RuneDsl } = createRuneDslServices();
  const factory = RuneDsl.shared.workspace.LangiumDocumentFactory;
  const builtins = factory.fromString(BASICTYPES_ROSETTA, URI.parse('inmemory:///basictypes.rosetta'));
  const doc = factory.fromString(
    `namespace test.sourcefunctions
import com.rosetta.model.*
func Example:
  inputs:
    amount number (1..1)
    value int (1..1)
    values number (0..*)
  output:
    result number (0..*)
  ${body}
`,
    URI.parse('inmemory:///source-function.rosetta')
  );
  await RuneDsl.shared.workspace.DocumentBuilder.build([builtins, doc]);
  expect(doc.parseResult.parserErrors).toEqual([]);
  expect(doc.references.filter((reference) => reference.error)).toEqual([]);
  const func = extractFuncs([doc], 'test.sourcefunctions', [])[0]!;
  return renderSourceTypeScriptFunction(func);
}

describe('source-facing TypeScript function bodies', () => {
  it('keeps named aliases and a single immutable output', async () => {
    expect((await project('alias total: amount * 2\n  set result: total + 1')).code).toBe(
      'const total = amount * 2;\nconst result = total + 1;\nreturn result;'
    );
  });

  it('uses let for an output assigned again', async () => {
    expect((await project('set result: amount\n  set result: amount + 1')).code).toBe(
      'let result = amount;\nresult = amount + 1;\nreturn result;'
    );
  });

  it('distinguishes scalar append from collection append', async () => {
    expect((await project('set result: values\n  add result: amount\n  add result: values')).code).toBe(
      'const result = values;\nresult.push(amount);\nresult.push(...values);\nreturn result;'
    );
  });

  it('keeps preconditions before evaluation and postconditions before return', async () => {
    expect(
      (
        await project(
          'condition Positive: amount > 0\n  set result: amount\n  post-condition WithinLimit: amount < 100'
        )
      ).code
    ).toBe(
      'assert(amount > 0, "Positive");\nconst result = amount;\nassert(amount < 100, "WithinLimit");\nreturn result;'
    );
  });

  it('runs a postcondition after a switch instead of returning around it', async () => {
    const { code } = await project(
      'set result: value switch 1 then 0, default 1\n  post-condition Positive: result > 0'
    );
    expect(code).toContain('let result;');
    expect(code).not.toContain('return 0;');
    expect(code.indexOf('assert(result > 0')).toBeGreaterThan(code.indexOf('switch (value)'));
    const execute = new Function('value', 'assert', code) as (
      value: number,
      assertion: (test: boolean) => void
    ) => number;
    const assertion = (test: boolean) => {
      if (!test) throw new Error('Postcondition failed');
    };
    expect(() => execute(1, assertion)).toThrow('Postcondition failed');
    expect(execute(2, assertion)).toBe(1);
  });

  it('uses direct case returns when no later output work is needed', async () => {
    const { code } = await project('set result: value switch 1 then 2, default 3');
    expect(code).toContain('case 1:\n    return 2;');
    expect(code).not.toContain('let result');
  });

  it('retains authored contracts around unavailable native bodies', async () => {
    const projection = await project(
      'condition Positive: amount > 0\n  post-condition WithinLimit: result count < 100'
    );
    expect(projection.code).toBe('assert(amount > 0, "Positive");\nassert(result.count() < 100, "WithinLimit");');
    expect(projection.implementation?.status).toBe('unavailable');
  });

  it('reports an unavailable external implementation without a fabricated body', async () => {
    const projection = await project('');
    expect(projection.code).toBe('');
    expect(projection.implementation).toEqual({
      status: 'unavailable',
      language: 'typescript',
      label: 'No TypeScript implementation available'
    });
  });
});
