// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, expect, it } from 'vitest';
import ts from 'typescript-classic';
import { AstUtils } from 'langium';
import { Temporal } from '@js-temporal/polyfill';
import { transpileExpression, type ExpressionTranspilerContext } from '../../src/expr/transpiler.js';
import { generatePythonModule } from '../../src/projection/python-functions.js';
import { nativeCount } from '../../src/expr/collection-shape.js';
import { RUNTIME_HELPER_JS_SOURCE } from '../../src/helpers.js';
import { linkedFunctions, runPython } from './python-test-utils.js';
import { emptyChoiceSource } from '../helpers/empty-choice.js';

const context: ExpressionTranspilerContext = {
  selfName: 'data',
  emitMode: 'ts-expression',
  typeName: 'Fixture',
  conditionName: 'Test',
  attributeTypes: new Map(),
  diagnostics: []
};

function execute(code: string, data: unknown) {
  const javascript = ts.transpileModule(`const result = (${code});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText;
  return new Function('data', 'Temporal', RUNTIME_HELPER_JS_SOURCE + '\n' + javascript + '\nreturn result;')(
    data,
    Temporal
  );
}

describe('native utilities from linked expression facts', () => {
  it('omits absent Choice constructors from lists while retaining actual constructed values', async () => {
    const funcs = await linkedFunctions(emptyChoiceSource);
    for (const emitMode of ['ts-expression', 'zod-refine'] as const) {
      const values = funcs
        .slice(0, 4)
        .map((func) => execute(transpileExpression(func.operations[0]!.expression, { ...context, emitMode }), {}));
      expect(values.slice(0, 4)).toEqual([[], 0, [{ leaf: { value: 7 } }], 1]);
    }
    const module = generatePythonModule([AstUtils.getDocument(funcs[0]!)]);
    expect(
      runPython(
        funcs.slice(0, 5).map((func) => ({ expression: `${func.name}(data)` })),
        module.code.replace(/^from __future__.*$/gm, '')
      )
    ).toEqual([{ value: [] }, { value: 0 }, { value: [{ leaf: { value: 7 } }] }, { value: 1 }, { value: 0 }]);
    expect(
      runPython(
        ['RequireList', 'RequireArgument'].map((name) => ({ expression: `${name}(data)` })),
        module.code.replace(/^from __future__.*$/gm, '')
      )
    ).toEqual([{ error: expect.stringMatching(/too few/) }, { error: expect.stringMatching(/requires a value/) }]);
  });

  it('uses native Python primitive sets with UTF-16 identity and empty containment rules', async () => {
    const funcs = await linkedFunctions(`namespace native.python_sets
func Contains:
 inputs: values string (0..*)
 output: result boolean (1..1)
 set result: values contains ["😀"]
func Distinct:
 inputs: values string (0..*)
 output: result string (0..*)
 set result: values distinct
`);
    const module = generatePythonModule([AstUtils.getDocument(funcs[0]!)]);
    for (const fragment of module.projections.filter((entry) => entry.kind === 'function'))
      expect(fragment.body!.code).not.toMatch(/rune\.(contains|distinct|valueKey|list)/);
    const source = module.code.replace(/^from __future__.*$/gm, '');
    expect(
      runPython(
        [
          { expression: 'Contains({"values": ["\\ud83d\\ude00"]})' },
          { expression: 'Contains({"values": []})' },
          { expression: 'Distinct({"values": ["\\ud83d\\ude00", "😀"]})' }
        ],
        source
      )
    ).toEqual([{ value: true }, { value: false }, { value: ['😀'] }]);
  });
  it('reuses completed function output bounds without rechecking primitive call arguments', async () => {
    const funcs = await linkedFunctions(`namespace native.function_bounds
func Source:
 output: result int (1..1)
 set result: 3
func Identity:
 inputs: value int (1..1)
 output: result int (1..1)
 set result: value
func Forward:
 output: result int (1..1)
 set result: Identity(Source)
`);
    const module = generatePythonModule([AstUtils.getDocument(funcs[0]!)]);
    const body = module.projections.find((entry) => entry.kind === 'function' && entry.code.startsWith('def Forward('))!
      .body!.code;
    expect(body).not.toContain('rune.cardinality');
    expect(runPython([{ expression: 'Forward(data)' }], module.code.replace(/^from __future__.*$/gm, ''))).toEqual([
      { value: 3 }
    ]);
    const code = transpileExpression(funcs[2]!.operations[0]!.expression, context);
    expect(code).not.toMatch(/rune\.|requires a value/);
  });
  it('orders typed calendar values through Temporal without coercing them to strings', async () => {
    const funcs = await linkedFunctions(
      'namespace native.calendars\n' +
        ['sort', 'min', 'max']
          .map(
            (operation, index) => `
func Case${index}:
 inputs: values date (0..*)
 output: result date (0..*)
 set result: values ${operation}
`
          )
          .join('\n')
    );
    const early = Temporal.PlainDate.from('2026-01-01'),
      late = Temporal.PlainDate.from('2026-12-31');
    const code = funcs.map((func) => transpileExpression(func.operations[0]!.expression, context));
    for (const expression of code) expect(expression).not.toContain('rune.');
    expect(code.map((expression) => execute(expression, { values: [late, early] }))).toEqual([
      [early, late],
      early,
      late
    ]);
  });

  it('reads calendar fields from mixed scalar and collection branches in both expression modes', async () => {
    const funcs = await linkedFunctions(`namespace native.mixed_calendars
func Years:
 inputs: flag boolean (1..1) dates date (0..*) date date (0..1)
 output: result int (0..*)
 set result: (if flag then dates else date) -> year
`);
    const expression = funcs[0]!.operations[0]!.expression;
    for (const emitMode of ['ts-expression', 'zod-refine'] as const) {
      const code = transpileExpression(expression, { ...context, emitMode });
      if (emitMode === 'ts-expression') expect(code).not.toContain('rune.');
      const date = emitMode === 'ts-expression' ? Temporal.PlainDate.from('2026-10-13') : '2026-10-13';
      expect(execute(code, { flag: true, dates: [date] })).toEqual([2026]);
      expect(execute(code, { flag: false, date })).toEqual([2026]);
      expect(execute(code, { flag: true, dates: [] })).toEqual([]);
      expect(execute(code, { flag: false })).toEqual([]);
      let reads = 0;
      expect(
        execute(code, {
          flag: false,
          get date() {
            reads++;
            return date;
          }
        })
      ).toEqual([2026]);
      expect(reads).toBe(1);
    }
  });

  it('compares nullable calendar values natively and evaluates each operand once', async () => {
    const [func] = await linkedFunctions(`namespace native.optional_calendars
func Same:
 inputs: left date (0..1) right date (0..1)
 output: result boolean (1..1)
 set result: left = right
`);
    const code = transpileExpression(func!.operations[0]!.expression, context);
    expect(code).not.toContain('rune.');
    expect(execute(code, {})).toBe(true);
    const date = Temporal.PlainDate.from('2026-10-13');
    expect(execute(code, { left: date })).toBe(false);
    let reads = 0;
    expect(
      execute(code, {
        get left() {
          reads++;
          return date;
        },
        get right() {
          reads++;
          return date;
        }
      })
    ).toBe(true);
    expect(reads).toBe(2);
  });
  it('preserves missing collections, ordering and values without collection helpers', async () => {
    const texts = [
      'values count',
      'values first',
      'values last',
      'values only-element',
      'values sum',
      'values reverse',
      'values sort',
      'values min',
      'values max',
      'values distinct',
      'values filter [item > 1]',
      'values extract [item + 1]',
      'values contains [1, 2]',
      'values disjoint [4]'
    ];
    const funcs = await linkedFunctions(
      'namespace native.utilities\n' +
        texts
          .map(
            (text, index) => `
func Case${index}:
 inputs: values number (0..*)
 output: result number (0..*)
 set result: ${text}
`
          )
          .join('\n')
    );
    const code = funcs.map((func) => transpileExpression(func.operations[0]!.expression, context));
    for (const expression of code) expect(expression).not.toMatch(/rune\./);
    expect(code.map((expression) => execute(expression, { values: [3, 1, 2, 1] }))).toEqual([
      4,
      3,
      1,
      undefined,
      7,
      [1, 2, 1, 3],
      [1, 1, 2, 3],
      1,
      3,
      [3, 1, 2],
      [3, 2],
      [4, 2, 3, 2],
      true,
      true
    ]);
    expect(code.map((expression) => execute(expression, {}))).toEqual([
      0,
      undefined,
      undefined,
      undefined,
      0,
      [],
      [],
      undefined,
      undefined,
      [],
      [],
      [],
      false,
      true
    ]);
  });

  it('evaluates count operands once instead of folding away evaluation', async () => {
    const [func] = await linkedFunctions(`namespace native.counting
func Count:
 inputs: value number (1..1)
 output: result int (1..1)
 set result: value count
`);
    const code = nativeCount(
      'data.value',
      func!.operations[0]!.expression.$type === 'RosettaCountOperation'
        ? func!.operations[0]!.expression.argument
        : undefined
    );
    let reads = 0;
    expect(
      execute(code, {
        get value() {
          reads++;
          return 0;
        }
      })
    ).toBe(1);
    expect(reads).toBe(1);
  });

  it('keeps the first wrapper when distinct compares metadata payloads', async () => {
    const [func] = await linkedFunctions(`namespace native.metadata
annotation metadata:
 scheme string (0..1)
func Distinct:
 inputs: values string (0..*)
  [metadata scheme]
 output: result string (0..*)
  [metadata scheme]
 set result: values distinct
`);
    const code = transpileExpression(func!.operations[0]!.expression, { ...context, preserveMetadata: true });
    expect(code).not.toContain('rune.');
    const first = { value: 'A', meta: { scheme: 'first' } };
    const second = { value: 'A', meta: { scheme: 'second' } };
    const third = { value: 'B', meta: {} };
    const output = execute(code, { values: [first, second, third] });
    expect(output).toEqual([first, third]);
    expect(output[0]).toBe(first);
  });

  it.each(['all', 'any'] as const)(
    'retains %s positional equality, empty cases and primitive NaN identity',
    async (quantifier) => {
      const [func] = await linkedFunctions(`namespace native.equality
func Equal:
 inputs: left number (0..*) right number (0..*)
 output: result boolean (1..1)
 set result: left ${quantifier} = right
`);
      const code = transpileExpression(func!.operations[0]!.expression, context);
      expect(code).not.toContain('rune.');
      const oracle = new Function(
        'left',
        'right',
        `${RUNTIME_HELPER_JS_SOURCE}\nreturn rune.equals(left, right, '${quantifier}');`
      );
      const values = [undefined, [], [1], [2], [1, 2], [2, 1], [NaN], [0], [-0]];
      for (const left of values)
        for (const right of values)
          expect(execute(code, { left, right }), JSON.stringify([left, right])).toBe(oracle(left, right));
    }
  );

  it('records a Python body over typed data while exported code retains boundary normalization', async () => {
    const [func] = await linkedFunctions(`namespace native.python
type Entry:
 amount int (1..1)
func Read:
 inputs: entry Entry (1..1)
 output: result int (1..1)
 set result: entry -> amount
`);
    const module = generatePythonModule([AstUtils.getDocument(func!)]);
    const body = module.projections.find((entry) => entry.kind === 'function')!.body!.code;
    expect(body).not.toMatch(/rune\.(get|unwrap|assignmentValue|normalize\w*|cardinality|list)\(/);
    expect(module.code).toContain('input = rune.normalizeObject(');
    expect(
      runPython(
        [{ expression: 'Read(data)', data: { entry: { amount: 3 } } }],
        module.code.replace(/^from __future__.*$/gm, '')
      )
    ).toEqual([{ value: 3 }]);
    expect(
      runPython(
        [{ expression: 'projected(data)', data: { entry: { amount: 3 } } }],
        `def projected(input):\n${body
          .split('\n')
          .map((line) => '    ' + line)
          .join('\n')}`
      )
    ).toEqual([{ value: 3 }]);
  });
});
