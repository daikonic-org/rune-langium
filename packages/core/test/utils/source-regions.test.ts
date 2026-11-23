// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, it, expect } from 'vitest';
import {
  parse,
  isRosettaFunction,
  getFunctionImplementationRegion,
  getFunctionAliasInsertion,
  getExpressionRegions,
  getExpressionRows,
  getExpressionStatementRemoval,
  getMemberAccessOperatorRegions,
  getSourceComments,
  getSwitchCaseRemoval,
  findExpressionOwner,
  parseExpressionDraft,
  serializeRuneModel,
  createRuneDslServices
} from '../../src/index.js';

const header = `namespace test.regions
version "test"
func Calculate:
  inputs:
    x int (1..1)
  output:
    answer int (1..1)
`;
const implementation = `
  // 😀 preserve this comment
  alias increment: x + 1
  condition Positive: x > 0
  set answer: increment
  post-condition Valid: answer > 0`;
const neighbor = '\n\nfunc Neighbor:\n  output:\n    result int (1..1)\n  set result: 7\n';

describe('source regions', () => {
  it('locates direct and deep member operators without including arrows in strings or comments', () => {
    const source = 'Choose("->>", trade /* 😀 -> */ -> asset) ->> amount';
    const { parsed } = parseExpressionDraft(source);
    expect(parsed.hasErrors).toBe(false);
    expect(getMemberAccessOperatorRegions(parsed.value)).toEqual([
      { from: source.indexOf('-> asset'), to: source.indexOf('-> asset') + 2, operator: '->' },
      { from: source.indexOf('->> amount'), to: source.indexOf('->> amount') + 3, operator: '->>' }
    ]);
  });

  it('maps expression rows in grammar order with exact statement and CRLF offsets', async () => {
    const source = (
      header +
      implementation.replace('set answer: increment', 'set answer -> amount: x + 1\n  add answer: x') +
      neighbor
    ).replaceAll('\n', '\r\n');
    const { value, parserErrors } = await parse(source);
    expect(parserErrors).toEqual([]);
    const owner = value.elements.find(isRosettaFunction)!;
    const rows = getExpressionRows(owner);
    expect(rows.map((row) => row.kind)).toEqual(['alias', 'precondition', 'operation', 'operation', 'postcondition']);
    const nested = rows[2]!;
    expect(source.slice(nested.statement.from, nested.statement.to)).toBe('set answer -> amount: x + 1');
    expect(source.slice(nested.region.from, nested.region.to)).toBe('x + 1');
  });

  it.each([0, 1, 2])('removes switch arm %i and its separator', (index) => {
    const prefix = 'x switch ';
    const cases = ['1 then "a,b"', '2 then "c"', 'default "other"'];
    const source = prefix + cases.join(', ');
    const { parsed } = parseExpressionDraft(source);
    if (parsed.hasErrors || parsed.value.$type !== 'SwitchOperation') throw new Error('Expected a switch');
    const { region, replacement } = getSwitchCaseRemoval(source, parsed.value.cases[index]!)!;
    const edited = source.slice(0, region.from) + replacement + source.slice(region.to);
    expect(edited).toBe(prefix + cases.filter((_, position) => position !== index).join(', '));
    expect(parseExpressionDraft(edited).parsed.hasErrors).toBe(false);
  });

  it('retains comments and CRLF while removing a case and protects the sole case', () => {
    const source = 'x switch 1 then /* keep, 😀 */ 10,\r\n // keep with default\r\n default 0';
    const { parsed } = parseExpressionDraft(source);
    if (parsed.hasErrors || parsed.value.$type !== 'SwitchOperation') throw new Error('Expected a switch');
    const { region, replacement } = getSwitchCaseRemoval(source, parsed.value.cases[0]!)!;
    const edited = source.slice(0, region.from) + replacement + source.slice(region.to);
    expect(getSourceComments(edited).map(({ text }) => text)).toEqual(
      getSourceComments(source).map(({ text }) => text)
    );
    expect(edited.replaceAll('\r\n', '')).not.toContain('\n');
    const { parsed: remaining } = parseExpressionDraft(edited);
    if (remaining.hasErrors || remaining.value.$type !== 'SwitchOperation') throw new Error('Expected a switch');
    expect(remaining.value.cases).toHaveLength(1);
    expect(getSwitchCaseRemoval(edited, remaining.value.cases[0]!)).toBeUndefined();
  });

  it.each(['\n', '\r\n'])('removes a last statement within the implementation (%j)', async (newline) => {
    const statement = '  set answer: x';
    const source = (header + statement + neighbor).replaceAll('\n', newline);
    const { value } = await parse(source);
    const owner = value.elements.find(isRosettaFunction)!;
    const body = getFunctionImplementationRegion(owner, source);
    const { region, replacement } = getExpressionStatementRemoval(source, getExpressionRows(owner)[0]!.statement, body);
    expect(region).toEqual(body);
    expect(source.slice(0, region.from) + replacement + source.slice(region.to)).toBe(source.replace(statement, ''));
  });

  it.each(['condition Positive: x > 0', 'set answer: x', 'post-condition Good: answer exists'])(
    'inserts aliases before comments attached to %s',
    async (statement) => {
      const source = header + '  alias previous: x // alias comment\n  // statement comment\n  ' + statement + neighbor;
      const { value } = await parse(source);
      const owner = value.elements.find(isRosettaFunction)!;
      const anchor = source.indexOf('// statement comment');
      expect(getFunctionAliasInsertion(owner, source)).toEqual({ from: anchor, to: anchor });
    }
  );

  it('places an alias after a signature-only function without touching the following declaration', async () => {
    const source = header.trimEnd() + neighbor;
    const { value } = await parse(source);
    const owner = value.elements.find(isRosettaFunction)!;
    const anchor = header.trimEnd().length;
    expect(getFunctionAliasInsertion(owner, source)).toEqual({ from: anchor, to: anchor });
  });

  it.each(['', ' output: result int (1..1)\n  set result: 1', ' /* body */'])(
    'protects the next declaration’s documentation after body %j',
    async (body) => {
      for (const newline of ['\n', '\r\n']) {
        const next = '\n\n/** Neighbor documentation */\nfunc Neighbor:\n output: result int (1..1)\n set result: 2';
        const source = ('namespace test.regions\nfunc Previous:' + body + next).replaceAll('\n', newline);
        const parsed = await parse(source);
        expect(parsed.parserErrors).toEqual([]);
        const func = parsed.value.elements.find(isRosettaFunction)!;
        const range = getFunctionImplementationRegion(func, source);
        expect(source.slice(range.from, range.to)).not.toContain('Neighbor documentation');
        expect(range.to).toBe(source.indexOf(next.replaceAll('\n', newline)));
        const services = createRuneDslServices();
        const serialized = JSON.parse(serializeRuneModel(services.RuneDsl.serializer.JsonSerializer, parsed.value));
        expect(getFunctionImplementationRegion(serialized.elements[0], source)).toEqual(range);
      }
    }
  );

  it.each([
    ['func Inline: output: result int (1..1) ', '/* inline */\n  set result: 1'],
    ['func Multiline: output: result int (1..1) ', '/* inline\n     continuation */\n  set result: 1'],
    ['func Line: output: result int (1..1) ', '// inline\n  set result: 1'],
    ['func CommentOnly: ', '/* comment-only */'],
    ['func LineOnly: ', '// comment-only'],
    ['func EmptyNextLine:\n', '  /* comment-only */'],
    ['func Trailing: output: result int (1..1)\n', '  set result: 1\n  // trailing']
  ])('keeps implementation trivia after %s', async (signature, body) => {
    for (const newline of ['\n', '\r\n']) {
      const source = ('namespace test.regions\n' + signature + body + neighbor).replaceAll('\n', newline);
      const parsed = await parse(source);
      expect(parsed.parserErrors).toEqual([]);
      const func = parsed.value.elements.find(isRosettaFunction)!;
      const range = getFunctionImplementationRegion(func, source);
      expect(source.slice(range.from, range.to)).toBe(body.replaceAll('\n', newline));
      const services = createRuneDslServices();
      const serialized = JSON.parse(serializeRuneModel(services.RuneDsl.serializer.JsonSerializer, parsed.value));
      expect(getFunctionImplementationRegion(serialized.elements[0], source)).toEqual(range);
    }
  });

  it('resolves same-named owners by kind and rejects ambiguous legacy identities', async () => {
    const { value } = await parse(
      'namespace test\ntype Shared:\n amount int (1..1)\nfunc Shared:\n output: out int (1..1)\n set out: 1'
    );
    expect(findExpressionOwner(value, { name: 'Shared', kind: 'Data' })?.$type).toBe('Data');
    expect(findExpressionOwner(value, { name: 'Shared', kind: 'RosettaFunction' })?.$type).toBe('RosettaFunction');
    expect(findExpressionOwner(value, { name: 'Shared' })).toBeUndefined();
    expect(findExpressionOwner(value, { name: 'Shared', kind: 'Choice' })).toBeUndefined();
    expect(findExpressionOwner(value, { name: 'Missing' })).toBeUndefined();
    expect(findExpressionOwner({ elements: [value.elements[1]!] }, { name: 'Shared' })?.$type).toBe('RosettaFunction');
  });

  it.each([false, true])('resolves a dispatch group to its base with base first=%s', async (baseFirst) => {
    const base =
      'func Compute:\n inputs: kind Kind (1..1)\n          amount int (1..1)\n output: result int (1..1)\n set result: amount\n';
    const variants =
      'func Compute(kind: Kind -> Cash):\n set result: amount + 1\nfunc Compute(kind: Kind -> Credit):\n set result: amount + 2\n';
    const { value, parserErrors } = await parse(
      'namespace test\nenum Kind:\n Cash\n Credit\n' + (baseFirst ? base + variants : variants + base)
    );
    expect(parserErrors).toEqual([]);
    const services = createRuneDslServices();
    const serialized: typeof value = JSON.parse(serializeRuneModel(services.RuneDsl.serializer.JsonSerializer, value));
    for (const model of [value, serialized]) {
      const functions = model.elements.filter(isRosettaFunction);
      const baseFunction = functions.find((func) => !func.dispatchAttribute)!;
      expect(findExpressionOwner(model, { name: 'Compute', kind: 'RosettaFunction' })).toBe(baseFunction);
      expect(findExpressionOwner(model, { name: 'Compute' })).toBe(baseFunction);
      expect(
        findExpressionOwner({ elements: functions.filter((func) => func.dispatchAttribute) }, { name: 'Compute' })
      ).toBeUndefined();
      expect(
        findExpressionOwner({ elements: [functions.find((func) => func.dispatchAttribute)!] }, { name: 'Compute' })
      ).toBeUndefined();
      expect(findExpressionOwner({ elements: [...functions, baseFunction] }, { name: 'Compute' })).toBeUndefined();
      const data = (await parse('namespace test\ntype Compute:\n amount int (1..1)')).value.elements[0]!;
      const mixed = { elements: [...functions, data] };
      expect(findExpressionOwner(mixed, { name: 'Compute' })).toBeUndefined();
      expect(findExpressionOwner(mixed, { name: 'Compute', kind: 'Data' })).toBe(data);
      expect(findExpressionOwner(mixed, { name: 'Compute', kind: 'RosettaFunction' })).toBe(baseFunction);
    }
  });

  it('does not skip a body placed on the same line as its signature', async () => {
    const source =
      'namespace test.regions\nversion "test"\nfunc Compact: output: result int (1..1) set result: 1' + neighbor;
    const parsed = await parse(source);
    expect(parsed.parserErrors).toEqual([]);
    const func = parsed.value.elements.find(isRosettaFunction)!;
    const region = getFunctionImplementationRegion(func, source);
    expect(source.slice(region.from, region.to)).toBe('set result: 1');
  });
  it.each(['\n', '\r\n'])(
    'retains comments and grammar-ordered implementation at original UTF-16 offsets with %j',
    async (newline) => {
      const source = (header + implementation + neighbor).replaceAll('\n', newline);
      const parsed = await parse(source);
      expect(parsed.parserErrors).toEqual([]);
      const func = parsed.value.elements.find(isRosettaFunction)!;
      const region = getFunctionImplementationRegion(func, source);
      expect(source.slice(region.from, region.to)).toBe(implementation.replaceAll('\n', newline));
      const expressions = getExpressionRegions(func);
      expect(expressions.map((e) => e.kind)).toEqual(['alias', 'precondition', 'operation', 'postcondition']);
      expect(expressions.map((e) => source.slice(e.region.from, e.region.to))).toEqual([
        'x + 1',
        'x > 0',
        'increment',
        'answer > 0'
      ]);
      const services = createRuneDslServices();
      const serialized = JSON.parse(serializeRuneModel(services.RuneDsl.serializer.JsonSerializer, parsed.value));
      expect(getFunctionImplementationRegion(serialized.elements[0], source)).toEqual(region);
    }
  );

  it.each(['', '  [native]\n', '  inputs:\n    x int (1..1)\n'])(
    'provides a zero-length insertion for an empty body %j',
    async (tail) => {
      const source = `namespace test.regions\nversion "test"\nfunc Empty:\n${tail}`;
      const parsed = await parse(source);
      expect(parsed.parserErrors).toEqual([]);
      const func = parsed.value.elements.find(isRosettaFunction)!;
      const region = getFunctionImplementationRegion(func, source);
      expect(region).toEqual({ from: func.$cstNode!.end, to: func.$cstNode!.end });
    }
  );

  it('keeps a no-output body outside its header and neighboring declaration', async () => {
    const source = 'namespace test.regions\nversion "test"\nfunc Base:\n  alias value: 1' + neighbor;
    const { value } = await parse(source);
    const func = value.elements.find(isRosettaFunction)!;
    const range = getFunctionImplementationRegion(func, source);
    expect(source.slice(range.from, range.to)).toBe('  alias value: 1');
  });

  it('includes multiline comments after an inherited signature', async () => {
    const body = '\n  /* retain\n     every line\n  */\n  set result: 1';
    const source =
      'namespace test.regions\nversion "test"\nfunc Parent:\n  output:\n    result int (1..1)\n\nfunc Derived extends Parent:\n' +
      body +
      neighbor;
    const parsed = await parse(source);
    expect(parsed.parserErrors).toEqual([]);
    const func = parsed.value.elements.filter(isRosettaFunction).find((f) => f.name === 'Derived')!;
    const region = getFunctionImplementationRegion(func, source);
    expect(source.slice(region.from, region.to)).toBe(body);
    const services = createRuneDslServices();
    const serialized = JSON.parse(serializeRuneModel(services.RuneDsl.serializer.JsonSerializer, parsed.value));
    expect(
      getFunctionImplementationRegion(
        serialized.elements.find((f: { name: string }) => f.name === 'Derived'),
        source
      )
    ).toEqual(region);
  });
});
