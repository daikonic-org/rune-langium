// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, expect, it } from 'vitest';
import { parseExpression } from '@rune-langium/core';
import { generate } from '../../../src/export.js';
import { compileGeneratedTypeScript } from '../../helpers/compiled-typescript.js';
import { linkedFunctions } from '../../projection/python-test-utils.js';
import { AstUtils } from 'langium';
import { parseSourceTs } from '../../../src/lens/typescript/source-lens.js';
import { renderSourceTypeScriptExpression } from '../../../src/projection/source-typescript-expression.js';
import { renderExpression } from '../../../src/emit/rosetta/render-expression.js';
import { treesEquivalent } from '../../emit/rosetta/expression-tree-equivalence.js';

const cases = [
  ['values.map(item => item.amount * 2)', 'values extract [item -> amount * 2]'],
  ['values.flatMap(item => item.amounts)', '(values extract [item -> amounts]) flatten'],
  ['values.filter(item => item.amount > 0)', 'values filter [item -> amount > 0]'],
  ['trade.prop(item => item.amount)', 'trade ->> amount'],
  ['trade._.amount', 'trade ->> amount'],
  ['trade._.child._.amount', '(trade ->> child) ->> amount'],
  ['trade.field("_").amount', '(trade -> _) -> amount'],
  ['trade._._', 'trade ->> _'],
  ['values.reduce((left, right) => left + right)', 'values reduce left, right [left + right]'],
  ['values.first()', 'values first'],
  ['values.last()', 'values last'],
  ['values.count()', 'values count'],
  ['values.sum()', 'values sum'],
  ['values.distinct()', 'values distinct'],
  ['values.reverse()', 'values reverse'],
  ['values.flat()', 'values flatten'],
  ['values.onlyElement()', 'values only-element'],
  ['values.min(item => item.amount)', 'values min [item -> amount]'],
  ['values.sort()', 'values sort'],
  ['values.max()', 'values max'],
  ['values.join(",")', 'values join ","'],
  ['values.has(amount)', 'values contains amount'],
  ['values.isSupersetOf(other)', 'values contains other'],
  ['values.isDisjointFrom(other)', 'values disjoint other'],
  ['values.every(item => item > limit)', 'values all > limit'],
  ['xs.some(item => ys.some(other => item > other))', 'xs any > ys'],
  ['xs.every((item, index) => item == ys[index])', 'xs all = ys'],
  ['Point({x, y: other})', 'Point {x: x, y: other}'],
  ['partial(Point, {x})', 'Point {x: x, ...}'],
  ['Number(value)', 'value to-number'],
  ['String(value)', 'value to-string'],
  ['int(value)', 'value to-int'],
  ['Currency[value]', 'value to-enum Currency'],
  ['model.Currency[value]', 'value to-enum model.Currency'],
  ['value as model.Point', 'value as model.Point'],
  ['partial(model.Point, {x})', 'model.Point {x: x, ...}'],
  ['super()', 'super'],
  ['super(amount)', 'super(amount)'],
  ['Currency.USD', 'Currency -> USD'],
  ['date(value)', 'value to-date'],
  ['date({year, month, day})', 'date {year: year, month: month, day: day}'],
  ['value?.toPlainDate()', 'value -> date'],
  ['value instanceof Point', 'value as Point exists'],
  ['values.some(item => item instanceof model.Cash)', 'values as model.Cash exists'],
  ['value as Point', 'value as Point'],
  ['then(value, item => [item + 1])', 'value then [item + 1]'],
  ['then(amount, x => Point({x}))', 'amount then Point {x: item}'],
  ['then(amount, x => partial(Point, {x}))', 'amount then Point {x: item, ...}'],
  ['then(value, outer => values.map(outer => outer + 1))', 'value then (values extract outer [outer + 1])'],
  ['then(value, item => values.map(item => item + 1))', 'value then (values extract [item + 1])'],
  ['then(values, outer => outer.map(x => x * 2))', 'values then (item extract x [x * 2])'],
  ['then(value, outer => then(other, inner => inner + 1))', 'value then (other then item + 1)'],
  ['values.map(outer => other.map(x => outer + x))', 'values extract outer [other extract x [outer + x]]'],
  ['then(value, outer => values.every(x => x > outer))', 'value then (values all > item)'],
  ['extract(value, item => 1)', 'value extract [1]'],
  ['singleExists(value)', 'value single exists'],
  ['multipleExists(value)', 'value multiple exists'],
  ['!exists(value)', 'value is absent'],
  ['exists(value)', 'value exists'],
  ['oneOf(value)', 'value one-of'],
  ['choice(value, item => [item.x, item.y], "required")', 'value required choice x, y'],
  ['onlyExists(value, item => [item.x, item.y])', '(value -> x, value -> y) only exists'],
  ['withMeta(value, {reference: ref})', 'value with-meta { reference: ref }'],
  ['asKey(value)', 'value as-key'],
  ['a ?? b', 'a default b'],
  ['a ? b : null', 'if a then b else empty'],
  ['null', 'empty'],
  ['Point({x}, {T: 5})', 'Point(T: 5) {x: x}'],
  ['a == b && c != d', 'a = b and c <> d'],
  ['Calculate(amount)', 'Calculate(amount)']
];
describe('source-facing expression inverse', () => {
  it.each(cases)('translates %s through canonical Rune syntax', async (text, rune) => {
    const result = await parseSourceTs(text!);
    expect(result, text).toMatchObject({ ok: true });
    if (!result.ok) return;
    const expected = parseExpression(rune!);
    expect(expected.hasErrors, rune).toBe(false);
    expect(treesEquivalent(expected.value, result.node), renderExpression(result.node)).toBe(true);
  });
  it('links constructor shorthand to its pipeline argument rather than a same-named function input', async () => {
    const result = await parseSourceTs('then(amount, x => Point({x}))');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const nested = await parseSourceTs('values.map(outer => values.map(inner => outer + inner)).flat()');
    expect(nested.ok).toBe(true);
    if (!nested.ok) return;
    const functions = await linkedFunctions(`namespace lens.lexical
 type Point:
  x int (1..1)
 func Case:
  inputs: amount int (1..1) x int (1..1)
  output: result Point (1..1)
  set result: ${renderExpression(result.node)}
 func Nested:
  inputs: values int (0..*)
  output: result int (0..*)
  set result: ${renderExpression(nested.node)}
`);
    const fn = functions[0]!;
    const documents = [AstUtils.getDocument(fn.inputs[0]!.typeCall!.type.ref!), AstUtils.getDocument(fn)];
    const outputs = await generate(documents, { target: 'typescript', typescript: { layout: 'single-file' } });
    const api = compileGeneratedTypeScript<{
      Case(amount: number, x: number): { x: number };
      Nested(values: number[]): number[];
    }>(outputs);
    expect(api.Case(7, 99)).toEqual({ x: 7 });
    expect(api.Nested([1, 2])).toEqual([2, 3, 3, 4]);
  });
  it('retains operation identity and trivia across formatter-only changes', async () => {
    const expression = parseExpression('values extract [item = "x"]');
    const projection = renderSourceTypeScriptExpression(expression.value);
    const result = await parseSourceTs(
      projection.code.replace('"x"', "'x'").replace('item =>', '(item) =>'),
      undefined,
      structuredClone(projection.origin)
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(treesEquivalent(expression.value, result.node)).toBe(true);
  });
  it('refuses origin edits when hydrated ranges have no original source text', async () => {
    const expression = parseExpression('amount*2').value;
    for (const node of AstUtils.streamAst(expression)) {
      const cst = node.$cstNode!;
      Object.defineProperty(node, '$cstRange', { value: { offset: cst.offset, end: cst.end } });
      Reflect.deleteProperty(node, '$cstNode');
    }
    const projection = renderSourceTypeScriptExpression(expression);
    expect(projection.origin.fragments).toEqual([]);
    const result = await parseSourceTs(projection.code.replace('2', '3'), undefined, projection.origin);
    expect(result.ok).toBe(false);
  });

  it('changes a literal while preserving the scalar extraction origin', async () => {
    const expression = parseExpression('amount extract [item * 2]');
    const projection = renderSourceTypeScriptExpression(expression.value);
    const result = await parseSourceTs(projection.code.replace('2', '3'), undefined, projection.origin);
    expect(result.ok).toBe(true);
    if (result.ok) expect(renderExpression(result.node)).toBe('amount extract [item * 3]');
  });
  it.each([
    'values.map(item => { return item; })',
    'value.toFixed(2)',
    'value = 3',
    'value === other',
    'window["alert"](1)',
    'new Point()',
    'values.push(1)',
    'then(value, outer => values.map(x => outer + x))',
    'then(value, item => values.map(x => item + x))',
    'then(value, outer => then(other, inner => outer + inner))',
    'values.map(item => other.map(x => item + x))',
    'then(value, outer => values.map(x => Point({outer})))',
    'then(value, outer => values.filter(x => x > outer))',
    'then(value, x => values.every(x => x > x))',
    'xs.every(x => ys.every(x => x > x))'
  ])('refuses unsupported editing syntax %s', async (text) => {
    expect(await parseSourceTs(text)).toMatchObject({ ok: false, reason: { kind: 'out-of-subset' } });
  });
});
