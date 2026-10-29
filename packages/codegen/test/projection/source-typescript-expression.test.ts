// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, expect, it } from 'vitest';
import { URI } from 'langium';
import { BASICTYPES_ROSETTA, createRuneDslServices, isRosettaFunction, isRosettaModel } from '@rune-langium/core';
import { parseSourceTs } from '../../src/lens/typescript/source-lens.js';
import { renderExpression } from '../../src/emit/rosetta/render-expression.js';
import { renderSourceTypeScriptExpression } from '../../src/projection/source-typescript-expression.js';

let sequence = 0;
async function project(expression: string, alias = '', extra = '') {
  const { RuneDsl } = createRuneDslServices();
  const factory = RuneDsl.shared.workspace.LangiumDocumentFactory;
  const builtins = factory.fromString(BASICTYPES_ROSETTA, URI.parse('inmemory:///basictypes.rosetta'));
  const doc = factory.fromString(
    `namespace test.source${sequence++}
import com.rosetta.model.*
type Child:
  amount number (1..1)
type Trade:
  amount number (1..1)
  _ number (0..1)
  amounts number (0..*)
  quantity number (1..1)
  price number (1..1)
  child Child (0..1)
type Point:
  x number (0..1)
  y number (0..1)
enum Currency:
  USD
  EUR
${extra}
func Example:
  inputs:
    trades Trade (0..*)
    trade Trade (1..1)
    amount number (1..1)
    maybeAmount number (0..1)
    other number (0..*)
    value string (1..1)
    x number (1..1)
    y number (1..1)
  output:
    result number (0..*)
  ${alias}
  set result: ${expression}
`,
    URI.parse('inmemory:///source-projection.rosetta')
  );
  await RuneDsl.shared.workspace.DocumentBuilder.build([builtins, doc]);
  expect(doc.parseResult.parserErrors).toEqual([]);
  expect(doc.references.filter((reference) => reference.error)).toEqual([]);
  const model = doc.parseResult.value;
  if (!isRosettaModel(model)) throw new Error('Expected a Rune model.');
  const owner = model.elements.find((node) => isRosettaFunction(node) && node.name === 'Example')!;
  if (!isRosettaFunction(owner)) throw new Error('Expected function.');
  return renderSourceTypeScriptExpression(owner.operations[0]!.expression!, { owner });
}

describe('source-facing TypeScript expressions', () => {
  it.each([
    ['trades -> amount', 'trades.map(item => item.amount)'],
    ['trades -> _', 'trades.map(item => item.field("_"))'],
    ['trades extract [_]', 'trades.map(item => item.field("_"))'],
    ['trades -> amounts', 'trades.flatMap(item => item.amounts)'],
    ['trade -> child -> amount', 'trade.child?.amount'],
    ['trade ->> amount', 'trade._.amount'],
    ['trades filter [amount > 0]', 'trades.filter(item => item.amount > 0)'],
    ['trades extract [quantity * price]', 'trades.map(item => item.quantity * item.price)'],
    ['trades extract [amounts]', 'trades.map(item => item.amounts)'],
    ['(trades extract [amounts]) flatten', 'trades.map(item => item.amounts).flat()'],
    ['amount extract [item * 2]', 'amount * 2'],
    ['maybeAmount extract [1]', 'extract(maybeAmount, item => 1)'],
    ['amount filter [item > 0]', 'amount > 0 ? amount : null'],
    ['other first', 'other.first()'],
    ['other last', 'other.last()'],
    ['other count', 'other.count()'],
    ['other sum', 'other.sum()'],
    ['other distinct', 'other.distinct()'],
    ['other reverse', 'other.reverse()'],
    ['other only-element', 'other.onlyElement()'],
    ['other sort', 'other.sort()'],
    ['trades sort [amount]', 'trades.sort(item => item.amount)'],
    ['trades min [amount]', 'trades.min(item => item.amount)'],
    ['other contains amount', 'other.has(amount)'],
    ['other contains other', 'other.isSupersetOf(other)'],
    ['other disjoint other', 'other.isDisjointFrom(other)'],
    ['amount = x', 'amount == x'],
    ['amount <> x', 'amount != x'],
    ['trade as Trade exists', 'trade instanceof Trade'],
    ['trades as Trade exists', 'trades.some(item => item instanceof Trade)'],
    ['maybeAmount exists', 'exists(maybeAmount)'],
    ['maybeAmount is absent', '!exists(maybeAmount)'],
    ['other single exists', 'singleExists(other)'],
    ['other multiple exists', 'multipleExists(other)'],
    ['Point { x: x, y: y }', 'Point({ x, y })'],
    ['Point { x: x, ... }', 'partial(Point, { x })'],
    ['value to-number', 'Number(value)'],
    ['value to-string', 'String(value)'],
    ['value to-int', 'int(value)'],
    ['value to-enum Currency', 'Currency[value]'],
    ['Currency -> USD', 'Currency.USD'],
    ['value to-date', 'date(value)'],
    ['value to-time', 'time(value)'],
    ['value to-date-time', 'dateTime(value)'],
    ['value to-zoned-date-time', 'zonedDateTime(value)'],
    ['maybeAmount default amount', 'maybeAmount ?? amount'],
    ['amount then item + 1', 'then(amount, item => item + 1)'],
    ['amount then [item + 1]', 'then(amount, item => [item + 1])'],
    ['other reduce lhs, rhs [lhs + rhs]', 'other.reduce((lhs, rhs) => lhs + rhs)'],
    ['trade one-of', 'oneOf(trade)'],
    ['trade optional choice amount, price', 'choice(trade, item => [item.amount, item.price], "optional")'],
    ['(trade -> price, trade -> amount) only exists', 'onlyExists(trade, item => [item.price, item.amount])'],
    ['empty', 'null']
  ])('projects %s without executable scaffolding', async (rune, expected) => {
    const projection = await project(rune);
    expect(projection.code).toBe(expected);
    expect(projection.statements).toEqual([]);
  });

  it('retains collection navigation origin when its selected field changes', async () => {
    const projection = await project('trades -> amount');
    const result = await parseSourceTs(
      projection.code.replace('item.amount', 'item.price'),
      undefined,
      structuredClone(projection.origin)
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(renderExpression(result.node)).toBe('trades -> price');
  });

  it('retains grouped extraction origin during a field edit', async () => {
    const projection = await project('trades extract [amount]');
    const result = await parseSourceTs(
      projection.code.replace('item.amount', 'item.price'),
      undefined,
      projection.origin
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(renderExpression(result.node)).toBe('trades extract [item -> price]');
  });

  it('evaluates comparison operands once, in source order', async () => {
    const projection = await project(
      'Left() all > Right()',
      '',
      `func Left:
 output: result number (0..*)
 set result: [1, 2]
func Right:
 output: result number (1..1)
 set result: 0`
    );
    const calls: string[] = [];
    const run = new Function('Left', 'Right', [...projection.statements, `return ${projection.code};`].join('\n'));
    expect(
      run(
        () => {
          calls.push('left');
          return [1, 2];
        },
        () => {
          calls.push('right');
          return 0;
        }
      )
    ).toBe(true);
    expect(calls).toEqual(['left', 'right']);
  });

  it('keeps nullish and logical operator combinations syntactically grouped', async () => {
    const projection = await project('(amount > 0 and x > 0) default False');
    expect(projection.code).toBe('(amount > 0 && x > 0) ?? false');
    expect(() => new Function('amount', 'x', `return ${projection.code};`)).not.toThrow();
  });

  it('escapes an intrinsic shadowed by an authored lambda parameter', async () => {
    expect((await project('trades extract String [String -> amount to-string]')).code).toBe(
      'trades.map(String => rune.String(String.amount))'
    );
  });

  it('does not shadow a lambda parameter with a lifted switch local', async () => {
    const projection = await project('trades extract switchValue [switchValue -> amount switch 1 then 2, default 3]');
    expect(projection.code).toContain('let switchValue1;');
    expect(projection.code).not.toContain('let switchValue;');
    expect(projection.code).toContain('switchValue.amount');
  });

  it('escapes an intrinsic instead of renaming an authored alias', async () => {
    expect((await project('value to-number', 'alias Number: 7')).code).toBe('rune.Number(value)');
  });

  it('does not inline away an optional extraction receiver', async () => {
    const projection = await project('maybeAmount extract [item default 1]');
    expect(projection.code).toBe('extract(maybeAmount, item => item ?? 1)');
  });

  it('retains binary grouping during scalar substitution', async () => {
    expect((await project('(amount + x) extract [item * 2]')).code).toBe('(amount + x) * 2');
  });

  it('lifts a nested switch without shadowing an input or inventing a default', async () => {
    const projection = await project('Point { x: amount switch 1 then 2, 2 then 3 }');
    expect(projection.code).toBe('Point({ x: x1 })');
    expect(projection.statements.join('\n')).toBe(
      'let x1;\nswitch (amount) {\n  case 1:\n    x1 = 2;\n    break;\n  case 2:\n    x1 = 3;\n    break;\n}'
    );
  });

  it('keeps branch-local switches inside their conditional branch', async () => {
    const projection = await project(
      'if amount > 0 then Point { x: amount switch 1 then 2, default 3 } else Point { x: 0 }'
    );
    const statements = projection.statements.join('\n');
    expect(statements.indexOf('if (amount > 0)')).toBeLessThan(statements.indexOf('switch (amount)'));
    expect(projection.code).toMatch(/^conditional\d*$/);
  });
});
