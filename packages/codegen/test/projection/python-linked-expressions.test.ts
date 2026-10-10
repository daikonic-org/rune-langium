// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { AstUtils } from 'langium';
import { functionInputs } from '../helpers/function-inputs.js';
import { describe, expect, it } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import ts from 'typescript-classic';
import { projectPythonExpression } from '../../src/projection/python.js';
import { transpileExpression } from '../../src/expr/transpiler.js';
import { RUNTIME_HELPER_JS_SOURCE } from '../../src/helpers.js';
import { hasFieldMetadata, fieldMetadataKind } from '../../src/expr/metadata-runtime.js';
import { linkedFunctions, pythonContext, runPython } from './python-test-utils.js';

const declarations = `namespace python.linked
enum ParentColor:
 Red
enum Color extends ParentColor:
 Blue
type Leaf:
 amount number (1..1)
 extra number (0..1)
type BaseLeaf:
 baseValue number (0..1)
type DerivedLeaf extends BaseLeaf:
 amount number (1..1)
type Other:
 other string (1..1)
type Container:
 leaf Leaf (0..1)
 leaves Leaf (0..*)
choice Instrument:
 Leaf
 Other
recordType date {year int month int day int}
recordType time {}
recordType dateTime {date date time time}
recordType zonedDateTime {date date time time timezone string}
annotation metadata:
 scheme string (0..1)
 reference string (0..1)
 key string (0..1)
metaType scheme string
metaType reference string
metaType key string
`;
const cases = [
  ['nav', 'object Container (1..1)', 'object -> leaf -> amount', { object: { leaf: { amount: 3 } } }, 3],
  [
    'deep',
    'object Container (1..1)',
    'object ->> amount',
    { object: { leaf: { amount: 3 }, leaves: [{ amount: 4 }, { amount: 5 }] } },
    [3, 4, 5]
  ],
  [
    'choice',
    'object Instrument (1..1)',
    'object switch Leaf then item -> amount, Other then 2, default 0',
    { object: { leaf: { amount: 7 } } },
    7
  ],
  [
    'choiceDefault',
    'object Instrument (1..1)',
    'object switch Leaf then item -> amount, Other then 2, default 0',
    { object: {} },
    0
  ],
  ['as', 'object Instrument (1..1)', 'object as Leaf', { object: { leaf: { amount: 7 } } }, { amount: 7 }],
  ['asAbsent', 'object Instrument (1..1)', 'object as Leaf', { object: { other: { other: 'x' } } }, null],
  [
    'asManyChoice',
    'objects Instrument (0..*)',
    'objects as Leaf',
    { objects: [{ leaf: { amount: 0 } }, { other: { other: 'x' } }, {}, { leaf: { amount: 3 } }] },
    [{ amount: 0 }, { amount: 3 }]
  ],
  [
    'asManyData',
    'objects BaseLeaf (0..*)',
    'objects as DerivedLeaf',
    { objects: [{ baseValue: 2 }, { baseValue: 1, amount: 0 }, { amount: 3 }] },
    [{ baseValue: 1, amount: 0 }, { amount: 3 }]
  ],
  [
    'asManyMetadata',
    'objects BaseLeaf (0..*) [metadata scheme]',
    'objects as DerivedLeaf',
    {
      objects: [
        { value: { baseValue: 2 }, meta: { scheme: 'x' } },
        { value: { amount: 0 }, meta: { scheme: 'y' } }
      ]
    },
    [{ amount: 0 }]
  ],
  ['constructor', '', 'Leaf {amount: 7}', {}, { amount: 7 }],
  ['joinAbsentSeparator', 'separator string (0..1)', '["a", "b"] join separator', {}, 'a,b'],
  ['joinEmptySeparator', 'separator string (0..1)', '["a", "b"] join separator', { separator: '' }, 'ab'],
  ['joinPresentSeparator', 'separator string (0..1)', '["a", "b"] join separator', { separator: '|' }, 'a|b'],
  ['joinDefaultSeparator', '', '["a", "b"] join', {}, 'ab'],
  ['enum', 'text string (1..1)', 'text to-enum Color', { text: 'Red' }, 'Red'],
  ['enumBad', 'text string (1..1)', 'text to-enum Color', { text: 'Missing' }, null],
  ['implicit', 'objects Leaf (0..*)', 'objects extract [amount]', { objects: [{ amount: 0 }, { amount: 3 }] }, [0, 3]],
  [
    'closure',
    'objects Leaf (0..*)',
    'objects filter object [object -> amount > 1]',
    { objects: [{ amount: 0 }, { amount: 3 }] },
    [{ amount: 3 }]
  ],
  [
    'sort',
    'objects Leaf (0..*)',
    'objects sort [amount]',
    { objects: [{ amount: 2 }, { amount: 0 }] },
    [{ amount: 0 }, { amount: 2 }]
  ],
  ['only', 'object Leaf (1..1)', '(object -> amount) only exists', { object: { amount: 0 } }, true],
  ['onlyAbsent', 'object Leaf (1..1)', '(object -> amount) only exists', { object: { amount: 0, extra: 1 } }, false],
  ['date', 'value date (1..1)', 'value -> year', { value: '2026-10-08' }, 2026],
  ['dateConstructor', '', 'date {year: 2026,month: 10,day: 8}', {}, '2026-10-08'],
  ['dateDiff', 'left date (1..1) right date (1..1)', 'left - right', { left: '2026-10-08', right: '2026-10-01' }, 7],
  [
    'dateJoin',
    'left date (1..1) right time (1..1)',
    'left + right',
    { left: '2026-10-08', right: '12:00:00' },
    '2026-10-08T12:00:00'
  ],
  ['metadata', 'value number (1..1) [metadata scheme]', 'value + 2', { value: { value: 0, meta: { scheme: 'x' } } }, 2],
  [
    'metadataRead',
    'value number (1..1) [metadata scheme]',
    'value -> scheme',
    { value: { value: 0, meta: { scheme: 'x' } } },
    'x'
  ],
  [
    'metadataMap',
    'values number (0..*) [metadata scheme]',
    'values extract [item + 1]',
    { values: [{ value: 0, meta: { scheme: 'x' } }] },
    [1]
  ],
  [
    'metadataThen',
    'values number (0..*) [metadata scheme]',
    'values then item sum',
    {
      values: [
        { value: 0, meta: { scheme: 'x' } },
        { value: 2, meta: { scheme: 'y' } }
      ]
    },
    2
  ],
  ['metadataSet', 'value number (1..1)', 'value with-meta {scheme:"x"}', { value: 0 }, 0],
  [
    'metadataSwitchField',
    'object BaseLeaf (1..1) [metadata scheme]',
    'object switch DerivedLeaf then amount, BaseLeaf then baseValue, default 0',
    { object: { value: { amount: 0, baseValue: 2 }, meta: { scheme: 'x' } } },
    0
  ],
  [
    'metadataSwitchReference',
    'object BaseLeaf (1..1) [metadata reference]',
    'object switch DerivedLeaf then amount, BaseLeaf then baseValue, default 0',
    { object: { value: { amount: 3, baseValue: 2 }, externalReference: 'x' } },
    3
  ],
  [
    'metadataSwitchDefault',
    'object BaseLeaf (1..1) [metadata scheme]',
    'object switch DerivedLeaf then amount, BaseLeaf then baseValue, default 0',
    { object: { value: { baseValue: 2 }, meta: { scheme: 'x' } } },
    2
  ],
  [
    'metadataImplicitExtract',
    'objects Leaf (0..*) [metadata scheme]',
    'objects extract [amount]',
    {
      objects: [
        { value: { amount: 0 }, meta: { scheme: 'x' } },
        { value: { amount: 3 }, meta: { scheme: 'y' } }
      ]
    },
    [0, 3]
  ],
  [
    'metadataImplicitFilter',
    'objects Leaf (0..*) [metadata reference]',
    'objects filter [amount > 1]',
    {
      objects: [
        { value: { amount: 0 }, externalReference: 'a' },
        { value: { amount: 3 }, externalReference: 'b' }
      ]
    },
    [{ amount: 3 }]
  ],
  [
    'metadataImplicitSort',
    'objects Leaf (0..*) [metadata scheme]',
    'objects sort [amount]',
    {
      objects: [
        { value: { amount: 3 }, meta: { scheme: 'x' } },
        { value: { amount: 0 }, meta: { scheme: 'y' } }
      ]
    },
    [{ amount: 0 }, { amount: 3 }]
  ],
  [
    'metadataImplicitThen',
    'objects Leaf (0..*) [metadata scheme]',
    'objects then amount sum',
    {
      objects: [
        { value: { amount: 0 }, meta: { scheme: 'x' } },
        { value: { amount: 3 }, meta: { scheme: 'y' } }
      ]
    },
    3
  ],
  ['one', 'object Leaf (1..1)', 'object one-of', { object: { amount: 0 } }, true],
  ['oneBad', 'object Leaf (1..1)', 'object one-of', { object: { amount: 0, extra: 1 } }, false],
  ['choiceRule', 'object Leaf (1..1)', 'object required choice amount, extra', { object: { amount: 0 } }, true],
  [
    'outer',
    'objects Leaf (0..*) offset number (1..1)',
    'objects extract [amount + offset]',
    { objects: [{ amount: 2 }], offset: 3 },
    [5]
  ],
  [
    'outerClosure',
    'objects Leaf (0..*) offset number (1..1)',
    'objects extract object [object -> amount + offset]',
    { objects: [{ amount: 2 }], offset: 3 },
    [5]
  ],
  ['optionalChoice', 'object Leaf (0..1)', 'object optional choice amount, extra', { object: null }, false],
  ['optionalChoiceEmpty', 'object Leaf (0..1)', 'object optional choice amount, extra', { object: {} }, true],
  [
    'nanoDateJoin',
    'left date (1..1) right time (1..1)',
    'left + right',
    { left: '2026-10-08', right: '12:00:00.123456789' },
    '2026-10-08T12:00:00.123456789'
  ],
  [
    'nanoDateTime',
    'value dateTime (1..1)',
    'value -> time',
    { value: '2026-10-08T12:00:00.123456789' },
    '12:00:00.123456789'
  ],
  [
    'nanoCompare',
    'left time (1..1) right time (1..1)',
    'left < right',
    { left: '12:00:00.123456788', right: '12:00:00.123456789' },
    true
  ],
  [
    'zonedTime',
    'value zonedDateTime (1..1)',
    'value -> time',
    { value: '2026-10-08T12:00:00.123456789-04:00[America/New_York]' },
    '12:00:00.123456789'
  ],
  [
    'fold',
    'left zonedDateTime (1..1) right zonedDateTime (1..1)',
    'left < right',
    { left: '2026-11-01T01:30:00-04:00[America/New_York]', right: '2026-11-01T01:15:00-05:00[America/New_York]' },
    true
  ],
  ['yearZero', 'value date (1..1)', 'value -> year', { value: '0000-02-29' }, 0],
  [
    'yearZeroZonedTime',
    'value zonedDateTime (1..1)',
    'value -> time',
    { value: '0000-02-29T12:00:00.123456789+00:00[UTC]' },
    '12:00:00.123456789'
  ],
  [
    'yearZeroZonedCompare',
    'left zonedDateTime (1..1) right zonedDateTime (1..1)',
    'left < right',
    { left: '0000-02-29T23:30:00-01:00[-01:00]', right: '0000-03-01T00:15:00+00:00[UTC]' },
    false
  ],
  [
    'zonedAbsoluteDate',
    'value zonedDateTime (1..1)',
    'value -> date',
    { value: '2026-10-08T01:00:00Z[America/New_York]' },
    '2026-10-07'
  ],
  [
    'zonedFixedAbsoluteDate',
    'value zonedDateTime (1..1)',
    'value -> date',
    { value: '0000-03-01T01:00:00Z[-04:00]' },
    '0000-02-29'
  ],
  [
    'zonedGapConstructor',
    '',
    'zonedDateTime {date: "2026-03-08" to-date, time: "02:30:00.123456789" to-time, timezone: "America/New_York"}',
    {},
    '2026-03-08T03:30:00.123456789-04:00[America/New_York]'
  ],
  [
    'yearZeroZonedConstructor',
    '',
    'zonedDateTime {date: date {year: 0, month: 2, day: 29}, time: "12:00:00" to-time, timezone: "UTC"}',
    {},
    '0000-02-29T12:00:00+00:00[UTC]'
  ],
  [
    'yearZeroConstructor',
    '',
    'dateTime {date: date {year: 0, month: 2, day: 29}, time: "12:00:00.123456789" to-time}',
    {},
    '0000-02-29T12:00:00.123456789'
  ],
  [
    'yearZeroDiff',
    'left date (1..1) right date (1..1)',
    'left - right',
    { left: '0000-03-01', right: '0000-02-28' },
    2
  ],
  [
    'yearZeroJoin',
    'left date (1..1) right time (1..1)',
    'left + right',
    { left: '0000-02-29', right: '12:00:00.123456789' },
    '0000-02-29T12:00:00.123456789'
  ]
] as const;

describe('linked Python expressions', () => {
  it('retains the wrappers of collection elements selected by as', async () => {
    const [func] = await linkedFunctions(
      declarations +
        `func Select:
 inputs: objects BaseLeaf (0..*) [metadata scheme]
 output: result DerivedLeaf (0..*) [metadata scheme]
 set result: objects as DerivedLeaf`
    );
    const code = projectPythonExpression(func!.operations[0]!.expression, {
      ...pythonContext(),
      preserveMetadata: true
    }).code;
    const retained = { value: { amount: 0 }, meta: { scheme: 'y' } };
    expect(
      runPython([
        { expression: code, data: { objects: [{ value: { baseValue: 2 }, meta: { scheme: 'x' } }, retained] } }
      ])
    ).toEqual([{ value: [retained] }]);
  });

  it('executes declarations, scopes, Choice paths, metadata and temporal operations through canonical facts', async () => {
    const funcs = await linkedFunctions(
      declarations +
        cases
          .map(
            ([, inputs, text], index) =>
              `func Case${index}:\n ${inputs ? 'inputs: ' + inputs : ''}\n output: result number (0..*)\n set result: ${text}\n`
          )
          .join('\n')
    );
    const python = funcs.map((func) => projectPythonExpression(func.operations[0]!.expression, pythonContext()).code);
    expect(runPython(cases.map(([, , , data], index) => ({ data, expression: python[index]! })))).toEqual(
      cases.map(([, , , , value]) => ({ value }))
    );
    const outputs = funcs.map((func, index) => {
      const expression = transpileExpression(func.operations[0]!.expression, {
        selfName: 'data',
        emitMode: 'ts-expression',
        typeName: 'Fixture',
        conditionName: func.name,
        attributeTypes: new Map(
          func.inputs.map((input) => [
            input.name,
            `unknown${input.card.inf === 0 ? ' | undefined' : ''}${input.card.unbounded ? '[]' : ''}`
          ])
        ),
        metadataAttributes: new Set(func.inputs.filter(hasFieldMetadata).map((input) => input.name)),
        localMetadata: new Map(
          func.inputs.map((input) => [
            input.name,
            fieldMetadataKind(input)
              ? { kind: fieldMetadataKind(input)!, many: input.card.unbounded || (input.card.sup ?? 1) > 1 }
              : undefined
          ])
        ),
        diagnostics: []
      });
      const source = ts.transpileModule(`function execute(data) { return (${expression}); }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 }
      }).outputText;
      return new Function('Temporal', 'data', RUNTIME_HELPER_JS_SOURCE + '\n' + source + '\nreturn execute(data);')(
        Temporal,
        /\b(date|time|dateTime|zonedDateTime)\b/.test(String(cases[index]![1]))
          ? functionInputs(
              [AstUtils.getDocument(func)],
              `python.linked.${func.name}`,
              cases[index]![3] as Record<string, unknown>
            )
          : cases[index]![3]
      );
    });
    expect(JSON.parse(JSON.stringify(outputs))).toEqual(cases.map(([, , , , value]) => value));
  });
});
