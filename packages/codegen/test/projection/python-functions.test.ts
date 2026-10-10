// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import ts from 'typescript-classic';
import { functionInputs } from '../helpers/function-inputs.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { AstUtils, URI, type LangiumDocument } from 'langium';
import {
  assertValidDocuments,
  createRuneDslServices,
  getNodeSourceRegion,
  BASICTYPES_ROSETTA
} from '@rune-langium/core';
import {
  createPythonProjectionContext,
  generatePythonModule,
  projectPythonCondition,
  selectPythonProjection
} from '../../src/projection/python-functions.js';
import { referenceCases, referenceFiles } from '../helpers/cdm-reference.js';
import { linkedFunctions } from './python-test-utils.js';
import { normalizePreviewInputs } from '../../src/preview-schema.js';
import { PYTHON_RUNTIME_SOURCE } from '../../src/projection/python-runtime.js';
import { generate } from '../../src/export.js';

function execute(source: string, cases: readonly { expression: string; data?: unknown }[]) {
  const result = spawnSync(
    process.env.PYTHON_BINARY ?? 'python3',
    [new URL('python-runtime-check.py', import.meta.url).pathname],
    {
      encoding: 'utf8',
      input: JSON.stringify({ source, cases })
    }
  );
  expect(result.status, result.error?.message ?? result.stderr).toBe(0);
  return JSON.parse(result.stdout) as Array<{ value?: unknown; error?: string }>;
}

async function executableFunctions<T extends Record<string, unknown> = Record<string, (data: object) => unknown>>(
  source: string
) {
  const funcs = await linkedFunctions(source);
  const document = AstUtils.getDocument(funcs[0]!);
  const python = generatePythonModule([document]);
  const [typescript] = await generate([document], {
    target: 'typescript',
    strict: true,
    typescript: { layout: 'single-file' }
  });
  const exports = {} as T;
  const javascript = ts.transpileModule(typescript!.content, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  new Function('require', 'exports', javascript)(createRequire(import.meta.url), exports);
  return { python, exports, document };
}

describe('complete Python function projections', () => {
  it.each(['eligibility', 'reporting'])('binds inherited metadata fields in %s rule root predicates', async (kind) => {
    for (const predicate of ['one-of', 'required choice scalar, many, flag', 'flag only exists']) {
      const { python, exports } = await executableFunctions(`namespace python.rule_fields
annotation metadata:
 reference string (0..1)
metaType reference string
type Parent:
 scalar number (0..1)
  [metadata reference]
 many number (0..*)
  [metadata reference]
type Terms extends Parent:
 flag boolean (0..1)
${kind} rule Check from Terms: ${predicate}
reporting rule Mapped from Terms: [1, 2] extract flag [flag]
func Probe:
 inputs: terms Terms (1..1)
 output: result boolean (1..1)
 set result: Check(terms)
func MapProbe:
 inputs: terms Terms (1..1)
 output: result number (0..*)
 set result: Mapped(terms)
`);
      const inputs = [
        {},
        { scalar: { externalReference: 'id' } },
        { flag: false },
        { scalar: { value: 0 } },
        { many: [{ value: 0 }] },
        { flag: false, scalar: { value: 0 } }
      ];
      const expected =
        predicate === 'flag only exists'
          ? [true, true, true, false, false, false]
          : [false, false, true, true, true, false];
      expect(
        execute(
          python.code,
          inputs.map((terms) => ({ expression: 'Probe(data)', data: { terms } }))
        )
      ).toEqual(expected.map((value) => ({ value })));
      expect(inputs.map((terms) => exports.Probe!({ terms }))).toEqual(expected);
      expect(execute(python.code, [{ expression: 'MapProbe(data)', data: { terms: { flag: false } } }])).toEqual([
        { value: [1, 2] }
      ]);
      expect(exports.MapProbe!({ terms: { flag: false } })).toEqual([1, 2]);
    }
  });

  it.each(['one-of', 'required choice scalar, many, flag', 'flag only exists'])(
    'reads metadata payloads in inherited root Data condition %s',
    async (predicate) => {
      const { python, exports } = await executableFunctions<{
        Terms: new (data: object) => { validateSelection(): { valid: boolean } };
      }>(`namespace python.root_metadata
annotation metadata:
 reference string (0..1)
metaType reference string
type Parent:
 scalar number (0..1)
  [metadata reference]
 many number (0..*)
  [metadata reference]
type Terms extends Parent:
 flag boolean (0..1)
 condition Selection: ${predicate}
func Identity:
 inputs: terms Terms (1..1)
 output: result Terms (1..1)
 set result: terms
`);
      const condition = python.projections.find((entry) => entry.kind === 'condition')!;
      const name = /^def (\w+)/.exec(condition.code)![1]!;
      const inputs = [
        {},
        { scalar: { externalReference: 'id' } },
        { many: [{ externalReference: 'id' }] },
        { flag: false, scalar: { externalReference: 'id' }, many: [{ externalReference: 'id' }] },
        { scalar: { value: 0 } },
        { many: [{ value: 0 }] },
        { flag: false, scalar: { value: 0 } }
      ];
      const expected = inputs.map((data) => new exports.Terms(data).validateSelection().valid);
      expect(expected).toEqual(
        predicate === 'flag only exists'
          ? [true, true, true, true, false, false, false]
          : [false, false, false, true, true, true, false]
      );
      expect(
        execute(
          python.code,
          inputs.map((data) => ({ expression: `${name}(data)`, data }))
        )
      ).toEqual(expected.map((value) => ({ value })));
    }
  );

  it.each(['condition', 'post-condition'])('reads metadata root locals in function %s one-of', async (kind) => {
    const { python, exports } = await executableFunctions(`namespace python.local_metadata
annotation metadata:
 reference string (0..1)
metaType reference string
func Build:
 inputs:
  scalar number (0..1)
   [metadata reference]
  flag boolean (0..1)
 output: result number (0..1)
 ${kind === 'condition' ? 'condition Selection: one-of' : ''}
 set result: 0
 ${kind === 'post-condition' ? 'post-condition Selection: one-of' : ''}
`);
    const inputs = [
      { scalar: { externalReference: 'id' } },
      { scalar: { externalReference: 'id' }, flag: false },
      { scalar: { value: 0 } }
    ];
    const results = execute(
      python.code,
      inputs.map((data) => ({
        expression: `${python.bindings.get('python.local_metadata.Build')}(data)`,
        data
      }))
    );
    inputs.forEach((data, index) => {
      const valid = kind === 'condition' ? index !== 0 : index === 0;
      if (valid) {
        expect(exports.Build!(data)).toBe(0);
        expect(results[index]).toEqual({ value: 0 });
      } else {
        expect(() => exports.Build!(data)).toThrow(/Selection/);
        expect(results[index]?.error).toContain('Selection');
      }
    });
  });

  it('ignores reference-only output payloads in only-exists postconditions', async () => {
    const { python, exports } = await executableFunctions(`namespace python.only_metadata
annotation metadata:
 reference string (0..1)
metaType reference string
func Build:
 inputs: flag boolean (0..1)
 output: result number (0..1)
  [metadata reference]
 set result: empty with-meta {reference: "id"}
 post-condition Selection: flag only exists
`);
    const data = { flag: false };
    const expected = JSON.parse(JSON.stringify(exports.Build!(data), (_key, value) => value ?? null));
    expect(
      execute(python.code, [
        {
          expression: `${python.bindings.get('python.only_metadata.Build')}(data)`,
          data
        }
      ])
    ).toEqual([{ value: expected }]);
  });

  it.each(['<', '<=', '>', '>='])('uses UTF-16 ordering for scalar and lifted string %s', async (operator) => {
    const declarations = ['1..1', '0..1', '0..*']
      .map(
        (card, index) => `func Compare${index}:
 inputs:
  left string (${card})
  right string (${card})
 output: result boolean (1..1)
 set result: left ${operator} right`
      )
      .join('\n');
    const { python, exports } = await executableFunctions('namespace python.string_order\n' + declarations);
    const pairs = [
      ['𐀀', '\ue000'],
      ['\ue000', '𐀀'],
      ['𐀀', '𐀀'],
      ['a', 'aa'],
      ['\ud800', '\udc00']
    ];
    const cases = ['Compare0', 'Compare1', 'Compare2'].flatMap((name) =>
      pairs.map(([left, right]) => ({
        name,
        data: name === 'Compare2' ? { left: [left], right: [right] } : { left, right }
      }))
    );
    const expected = cases.map(({ name, data }) => ({ value: exports[name]!(data) }));
    expect(
      execute(
        python.code,
        cases.map(({ name, data }) => ({
          expression: `${python.bindings.get('python.string_order.' + name)}(data)`,
          data
        }))
      )
    ).toEqual(expected);
  });

  it('uses UTF-16 keys for sort, min, max and constructed string equality', async () => {
    const { python, exports } = await executableFunctions(`namespace python.string_keys
func Sort:
 inputs: values string (0..*)
 output: result string (0..*)
 set result: values sort
func Min:
 inputs: values string (0..*)
 output: result string (0..1)
 set result: values min
func Max:
 inputs: values string (0..*)
 output: result string (0..1)
 set result: values max
func Equal:
 inputs:
  left string (1..1)
  right string (1..1)
  joined string (1..1)
 output: result boolean (1..1)
 set result: (left + right) = joined
`);
    const cases = ['Sort', 'Min', 'Max'].map((name) => ({ name, data: { values: ['\ue000', '𐀀', 'a'] } }));
    const expected = cases.map(({ name, data }) => ({ value: exports[name]!(data) }));
    expect(
      execute(
        python.code,
        cases.map(({ name, data }) => ({
          expression: `${python.bindings.get('python.string_keys.' + name)}(data)`,
          data
        }))
      )
    ).toEqual(expected);
    const data = { left: '\ud800', right: '\udc00', joined: '𐀀' };
    expect(exports.Equal!(data)).toBe(true);
    expect(
      execute(python.code, [
        {
          expression: `${python.bindings.get('python.string_keys.Equal')}(data)`,
          data
        }
      ])
    ).toEqual([{ value: true }]);
  });

  it.each(['value default 1', 'if choose then value else 1'])(
    'uses payload values from %s in arithmetic',
    async (expression) => {
      const { python, exports } = await executableFunctions(`namespace python.branch_values
annotation metadata:
 reference string (0..1)
metaType reference string
func Build:
 inputs:
  value number (0..1)
   [metadata reference]
  choose boolean (1..1)
 output: result number (0..1)
 set result: (${expression}) + 1
`);
      const inputs = [
        { value: { value: 0, externalReference: 'id' }, choose: true },
        { value: { value: 4, externalReference: 'id' }, choose: true },
        { value: { externalReference: 'id' }, choose: true },
        { choose: true },
        { value: { value: 4, externalReference: 'id' }, choose: false }
      ];
      const expected = inputs.map((data) => exports.Build!(data) ?? null);
      expect(expected).toEqual(expression.startsWith('value') ? [1, 5, 2, 2, 5] : [1, 5, null, null, 2]);
      expect(
        execute(
          python.code,
          inputs.map((data) => ({
            expression: `${python.bindings.get('python.branch_values.Build')}(data)`,
            data
          }))
        )
      ).toEqual(expected.map((value) => ({ value })));
    }
  );

  it('reduces payload values without losing reference-only metadata results', async () => {
    const { python, exports } = await executableFunctions(`namespace python.reduce_values
annotation metadata:
 reference string (0..1)
metaType reference string
func Sum:
 inputs:
  values number (0..*)
   [metadata reference]
 output: result number (0..1)
 set result: values reduce a, b [a + b]
func First:
 inputs:
  values number (0..*)
   [metadata reference]
 output: result number (0..1)
  [metadata reference]
 set result: values reduce a, b [a]
func FirstValue:
 inputs:
  values number (0..*)
   [metadata reference]
 output: result number (0..1)
 set result: (values reduce a, b [a]) + 1
`);
    const inputs = [
      { values: [] },
      { values: [{ externalReference: 'id' }] },
      { values: [{ externalReference: 'id' }, { externalReference: 'other' }] },
      { values: [{ externalReference: 'id' }, { value: 0 }, { value: 4 }] },
      { values: [{ value: 0 }, { externalReference: 'id' }, { value: 4 }] }
    ];
    const expected = ['Sum', 'First', 'FirstValue'].flatMap((name) =>
      inputs.map((data) => ({
        value: JSON.parse(JSON.stringify(exports[name]!(structuredClone(data)) ?? null))
      }))
    );
    expect(expected.slice(0, 5)).toEqual([null, null, null, 4, 4].map((value) => ({ value })));
    expect(
      execute(
        python.code,
        ['Sum', 'First', 'FirstValue'].flatMap((name) =>
          inputs.map((data) => ({
            expression: `${python.bindings.get('python.reduce_values.' + name)}(data)`,
            data
          }))
        )
      )
    ).toEqual(expected);
  });

  it('projects a year-zero named-zone constructor with its temporal fields', async () => {
    const { python, exports, document } = await executableFunctions(`namespace python.proleptic_zone
type Result:
 value zonedDateTime (1..1)
 date date (1..1)
 time time (1..1)
func Build:
 inputs:
  date date (1..1)
  time time (1..1)
  timezone string (1..1)
 output: result Result (1..1)
 alias stamp: zonedDateTime {date: date, time: time, timezone: timezone}
 set result: Result {value: stamp, date: stamp -> date, time: stamp -> time}
`);
    const data = { date: '0000-02-29', time: '12:00:00.123456789', timezone: 'America/New_York' };
    const expected = JSON.parse(
      JSON.stringify(exports.Build!(functionInputs([document], 'python.proleptic_zone.Build', data)))
    );
    expect(expected).toEqual({
      value: '0000-02-29T12:00:00.123456789-04:56[America/New_York]',
      date: data.date,
      time: data.time
    });
    expect(
      execute(python.code, [
        {
          expression: `${python.bindings.get('python.proleptic_zone.Build')}(data)`,
          data
        }
      ])
    ).toEqual([{ value: expected }]);
  });

  it.each([
    { entry: 'reference', expected: { value: null, externalReference: 'id' } },
    { entry: 'address', expected: { value: null, reference: { reference: 'id' } } },
    { entry: 'scheme', expected: null }
  ])('retains $entry metadata when applied to empty', async ({ entry, expected }) => {
    const funcs = await linkedFunctions(`namespace python.empty_metadata
annotation metadata:
 scheme string (0..1)
 reference string (0..1)
 address string (0..1)
metaType scheme string
metaType reference string
metaType address string
func Build:
 inputs: id string (1..1)
 output: result string (0..1)
  [metadata ${entry === 'scheme' ? 'scheme' : 'reference'}]
 set result: empty with-meta {${entry}: id}
`);
    const document = AstUtils.getDocument(funcs[0]!);
    const python = generatePythonModule([document]);
    const [typescript] = await generate([document], {
      target: 'typescript',
      strict: true,
      typescript: { layout: 'single-file' }
    });
    const exports: Record<string, (data: object) => unknown> = {};
    const javascript = ts.transpileModule(typescript!.content, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText;
    new Function('require', 'exports', javascript)(createRequire(import.meta.url), exports);
    const value = exports.Build!({ id: 'id' });
    expect(value === undefined ? null : JSON.parse(JSON.stringify(value, (_key, value) => value ?? null))).toEqual(
      expected
    );
    expect(
      execute(python.code, [
        {
          expression: `${python.bindings.get('python.empty_metadata.Build')}(data)`,
          data: { id: 'id' }
        }
      ])
    ).toEqual([{ value: expected }]);
  });

  it.each(['draft', 'rune'])('assigns through the allocated shortcut binding %s', async (alias) => {
    const funcs = await linkedFunctions(`namespace python.shortcut_assignment
type Foo:
 amount int (0..1)
 values int (0..*)
func Build:
 output: result Foo (1..1)
 alias ${alias}: Foo {}
 set ${alias} -> amount: 1
 add ${alias} -> values: 2
 add ${alias} -> values: 3
 set result: ${alias}
`);
    const document = AstUtils.getDocument(funcs[0]!);
    const python = generatePythonModule([document]);
    const [typescript] = await generate([document], {
      target: 'typescript',
      strict: true,
      typescript: { layout: 'single-file' }
    });
    const exports: Record<string, (data: object) => unknown> = {};
    const javascript = ts.transpileModule(typescript!.content, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText;
    new Function('require', 'exports', javascript)(createRequire(import.meta.url), exports);
    const expected = JSON.parse(JSON.stringify(exports.Build!({})));
    expect(expected).toEqual({ amount: 1, values: [2, 3] });
    expect(
      execute(python.code, [
        { expression: `${python.bindings.get('python.shortcut_assignment.Build')}(data)`, data: {} }
      ])
    ).toEqual([{ value: expected }]);
  });

  it.each(['collection', 'metadata'])('retains %s facts when assigning through a shortcut', async (shape) => {
    const metadata = shape === 'metadata' ? '\n  [metadata scheme]' : '';
    const card = shape === 'collection' ? '1..*' : '1..1';
    const funcs = await linkedFunctions(`namespace python.shortcut_shape
annotation metadata:
 scheme string (0..1)
metaType scheme string
type Foo:
 amount int (0..1)
 values int (0..*)
${
  shape === 'metadata'
    ? `func Wrap:
 inputs: original Foo (1..1)
 output: result Foo (1..1)
  [metadata scheme]
 set result: original
`
    : ''
}
func Build:
 inputs: original Foo (${card})
 output: result Foo (${card})${metadata}
 alias draft: ${shape === 'metadata' ? 'Wrap(original)' : 'original'}
 set draft -> amount: 1
 add draft -> values: 2
 add draft -> values: 3
 set result: draft
`);
    const document = AstUtils.getDocument(funcs[0]!);
    const python = generatePythonModule([document]);
    const [typescript] = await generate([document], {
      target: 'typescript',
      strict: true,
      typescript: { layout: 'single-file' }
    });
    const exports: Record<string, (data: object) => unknown> = {};
    const javascript = ts.transpileModule(typescript!.content, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText;
    new Function('require', 'exports', javascript)(createRequire(import.meta.url), exports);
    const original =
      shape === 'collection'
        ? [
            { amount: 0, values: [] },
            { amount: 7, values: [8] }
          ]
        : { amount: 0, values: [] };
    const expected =
      shape === 'collection'
        ? [
            { amount: 1, values: [2, 3] },
            { amount: 7, values: [8] }
          ]
        : { value: { amount: 1, values: [2, 3] }, meta: {} };
    expect(JSON.parse(JSON.stringify(exports.Build!({ original: structuredClone(original) })))).toEqual(expected);
    expect(
      execute(python.code, [
        { expression: `${python.bindings.get('python.shortcut_shape.Build')}(data)`, data: { original } }
      ])
    ).toEqual([{ value: expected }]);
  });

  it.each(['scheme', 'reference'])('preserves absence at %s metadata call and constructor boundaries', async (kind) => {
    const funcs = await linkedFunctions(`namespace python.absence
annotation metadata:
 scheme string (0..1)
 reference string (0..1)
metaType scheme string
metaType reference string
type Holder:
 wrapped number (0..1)
  [metadata ${kind}]
func Echo:
 inputs: value number (0..1)
  [metadata ${kind}]
 output: result number (0..1)
  [metadata ${kind}]
 set result: value
func Forward:
 inputs: value number (0..1)
 output: result number (0..1)
  [metadata ${kind}]
 set result: Echo(value)
func Required:
 inputs: value number (1..1)
  [metadata ${kind}]
 output: result number (1..1)
 set result: value
func RequireFromOptional:
 inputs: value number (0..1)
 output: result number (1..1)
 set result: Required(value)
func Create:
 inputs: value number (0..1)
 output: result Holder (1..1)
 set result: Holder {wrapped: value}
`);
    const doc = AstUtils.getDocument(funcs[0]!);
    const python = generatePythonModule([doc]);
    const [typescript] = await generate([doc], {
      target: 'typescript',
      strict: true,
      typescript: { layout: 'single-file' }
    });
    const exports: Record<string, (data: { value?: number }) => unknown> = {};
    const js = ts.transpileModule(typescript!.content, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText;
    new Function('require', 'exports', js)(createRequire(import.meta.url), exports);
    expect(exports.Forward!({})).toBeUndefined();
    const present = exports.Forward!({ value: 0 });
    expect(present).toEqual(kind === 'scheme' ? { value: 0, meta: {} } : { value: 0 });
    expect(() => exports.RequireFromOptional!({})).toThrow(/requires a value/);
    expect((exports.Create!({}) as { wrapped?: unknown }).wrapped).toBeUndefined();
    const name = (name: string) => python.bindings.get(`python.absence.${name}`)!;
    const results = execute(python.code, [
      { expression: `${name('Forward')}(data)`, data: {} },
      { expression: `${name('Forward')}(data)`, data: { value: 0 } },
      { expression: `${name('RequireFromOptional')}(data)`, data: {} },
      { expression: `${name('Create')}(data)["wrapped"]`, data: {} }
    ]);
    expect(results[0]).toEqual({ value: null });
    expect(results[1]).toEqual({ value: present });
    expect(results[2]?.error).toMatch(/requires a value/);
    expect(results[3]).toEqual({ value: null });
  });

  it('keeps the equality namespace separate from declaration, output and alias names', async () => {
    const funcs = await linkedFunctions(`namespace python.runtime_names
func rune:
 inputs:
  a number (1..1)
  b number (1..1)
 output: result boolean (1..1)
 set result: a = b
func CheckAlias:
 inputs:
  a number (1..1)
  b number (1..1)
 output: result boolean (1..1)
 alias rune: a
 set result: rune = b
func CheckOutput:
 inputs:
  a number (1..1)
  b number (1..1)
 output: rune boolean (1..1)
 set rune: a = b
`);
    const module = generatePythonModule([AstUtils.getDocument(funcs[0]!)]);
    expect(module.bindings.get('python.runtime_names.rune')).not.toBe('rune');
    for (const name of ['rune', 'CheckAlias', 'CheckOutput']) {
      const callable = module.bindings.get(`python.runtime_names.${name}`)!;
      expect(
        execute(module.code, [
          { expression: `${callable}(data)`, data: { a: 1, b: 1 } },
          { expression: `${callable}(data)`, data: { a: 1, b: 2 } }
        ])
      ).toEqual([{ value: true }, { value: false }]);
    }
  });
  it('reserves every builtin loaded by the authoritative Python runtime', async () => {
    const [scan] = execute('import ast\nimport builtins\n', [
      {
        expression: `sorted({node.id for node in ast.walk(ast.parse(${JSON.stringify(PYTHON_RUNTIME_SOURCE)})) if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load) and node.id in vars(builtins)})`
      }
    ]);
    expect(scan!.error).toBeUndefined();
    // These are grammar keywords and cannot be legal Rune function identifiers.
    const names = (scan!.value as string[]).filter((name) => !['all', 'any', 'min', 'set'].includes(name));
    const funcs = await linkedFunctions(
      'namespace python.builtins\n' +
        names.map((name) => `func ${name}:\n output: result number (1..1)\n set result: 1\n`).join('')
    );
    const module = generatePythonModule([AstUtils.getDocument(funcs[0]!)]);
    for (const name of names) expect(module.bindings.get(`python.builtins.${name}`)).not.toBe(name);
  });
  it('preserves absent required outputs and aliases until the final cardinality check', async () => {
    const funcs = await linkedFunctions(`namespace python.initialization
func RequiredOutput:
 inputs: flag boolean (1..1)
 output: result number (1..1)
 set result: if flag then 1
 set result: result + 1
func AliasOutput:
 inputs: flag boolean (1..1)
 output: result number (1..1)
 alias pending: result
 set result: pending + 1
`);
    const module = generatePythonModule([AstUtils.getDocument(funcs[0]!)]);
    const name = module.bindings.get('python.initialization.RequiredOutput')!;
    expect(execute(module.code, [{ expression: `${name}(data)`, data: { flag: false } }])[0]!.error).toContain(
      'produced'
    );
    expect(execute(module.code, [{ expression: `${name}(data)`, data: { flag: true } }])).toEqual([{ value: 2 }]);
    expect(
      execute(module.code, [
        { expression: `${module.bindings.get('python.initialization.AliasOutput')}(data)`, data: { flag: true } }
      ])[0]!.error
    ).toContain('produced');
    expect(module.code).toContain('result: float | None = None');
    expect(module.code).toContain(`def ${name}(input: ${name}_Input) -> float:`);
  });

  it('keeps comprehension bindings and runtime builtins separate from legal declarations', async () => {
    const funcs = await linkedFunctions(`namespace python.names
func Collision:
 inputs: xs number (0..*)
 output: child number (0..*)
 set child: [10]
 add child: xs extract [ child ]
func reversed:
 inputs: xs number (0..*)
 output: result number (0..*)
 set result: xs reverse
func callable:
 inputs: amount number (1..1)
 output: result number (1..1)
 set result: amount
func abs:
 output: result number (1..1)
 set result: 1
func divmod:
 output: result number (1..1)
 set result: 1
func OverflowError:
 output: result number (1..1)
 set result: 1
func Native:
 inputs: amount number (1..1)
 output: result number (1..1)
`);
    const module = generatePythonModule([AstUtils.getDocument(funcs[0]!)]);
    const call = (name: string) => module.bindings.get(`python.names.${name}`)!;
    expect(
      execute(module.code + '\nrune_bind("python.names.Native", lambda input: input["amount"] + 1)\n', [
        { expression: `${call('Collision')}(data)`, data: { xs: [1, 2] } },
        { expression: `${call('reversed')}(data)`, data: { xs: [1, 2] } },
        { expression: `${call('Native')}(data)`, data: { amount: 2 } }
      ])
    ).toEqual([{ value: [10, 10, 10] }, { value: [2, 1] }, { value: 3 }]);
    for (const builtin of ['reversed', 'callable', 'abs', 'divmod', 'OverflowError'])
      expect(call(builtin)).not.toBe(builtin);
  });

  it('accepts computed common parents for only-exists and keeps different parents distinct', async () => {
    const funcs = await linkedFunctions(`namespace python.selection
type Leaf:
 amount number (0..1)
 extra number (0..1)
type Other:
 name string (0..1)
choice Instrument:
 Leaf
 Other
func Check:
 inputs: object Instrument (1..1)
 output: result boolean (1..1)
 set result: ((object as Leaf) -> amount) only exists
func Both:
 inputs: object Instrument (1..1)
 output: result boolean (1..1)
 set result: (((object as Leaf) -> amount), ((object as Leaf) -> extra)) only exists
`);
    const module = generatePythonModule([AstUtils.getDocument(funcs[0]!)]);
    const check = module.bindings.get('python.selection.Check')!;
    expect(
      execute(module.code, [
        { expression: `${check}(data)`, data: { object: { leaf: { amount: 1 } } } },
        { expression: `${check}(data)`, data: { object: { leaf: { amount: 1, extra: 2 } } } },
        {
          expression: `${module.bindings.get('python.selection.Both')}(data)`,
          data: { object: { leaf: { amount: 1, extra: 2 } } }
        }
      ])
    ).toEqual([{ value: true }, { value: false }, { value: true }]);
    const different = await linkedFunctions(`namespace python.different
type Leaf:
 amount number (0..1)
 extra number (0..1)
type Other:
 name string (0..1)
choice Instrument:
 Leaf
 Other
func Check:
 inputs: left Instrument (1..1) right Instrument (1..1)
 output: result boolean (1..1)
 set result: (((left as Leaf) -> amount), ((right as Leaf) -> extra)) only exists
`);
    expect(() => generatePythonModule([AstUtils.getDocument(different[0]!)])).toThrow('linked common parent');
  });

  it('types a continuous body and preserves aliases, nested writes, append and condition order', async () => {
    const funcs = await linkedFunctions(`namespace python.functions
type Child:
 amount number (1..1)
type Result:
 child Child (1..1)
 values number (0..3)
func Build:
 inputs: value number (1..1)
 output: answer Result (1..1)
 alias doubled: value * 2
 condition Positive: doubled >= 0
 set answer -> child -> amount: doubled
 set answer -> values: [value]
 add answer -> values: doubled
 post-condition Complete: answer -> child -> amount >= 0
`);
    const document = AstUtils.getDocument(funcs[0]!);
    const module = generatePythonModule([document]);
    const name = module.bindings.get('python.functions.Build')!;
    expect(module.code).toContain(`def ${name}(input: ${name}_Input) -> Result:`);
    expect(
      execute(module.code + '\nfrom typing import get_type_hints\n', [
        {
          expression: `str(get_type_hints(${name}_Input)["value"])`
        }
      ])
    ).toEqual([{ value: "<class 'float'>" }]);
    expect(module.code).toContain('NotRequired[list[float]]');
    expect(execute(module.code, [{ expression: `${name}(data)`, data: { value: 2 } }])).toEqual([
      { value: { child: { amount: 4 }, values: [2, 4] } }
    ]);
    expect(execute(module.code, [{ expression: `${name}(data)`, data: { value: -1 } }])[0]!.error).toContain(
      'Positive'
    );
    const selected = selectPythonProjection(
      module,
      {
        uri: document.uri.toString(),
        nodeId: 'Build',
        region: getNodeSourceRegion(funcs[0]!)
      },
      'function'
    );
    expect(selected.language).toBe('python');
    expect(selected.code.match(/^def /gm)).toHaveLength(1);
    expect(selected.code.indexOf('doubled =')).toBeLessThan(selected.code.indexOf('Positive'));
    expect(selected.sourceMap[0]!.sourceUri).toBe(document.uri.toString());
    for (const condition of [...funcs[0]!.conditions, ...funcs[0]!.postConditions]) {
      const subject = {
        uri: document.uri.toString(),
        nodeId: 'Build',
        region: getNodeSourceRegion(condition.expression)
      };
      const guard = selectPythonProjection(module, subject, 'condition');
      expect(selected.code).toContain(
        guard.code
          .split('\n')
          .map((line) => '    ' + line)
          .join('\n')
      );
      expect(guard.code).toContain('raise ValueError');
      expect(projectPythonCondition(condition, createPythonProjectionContext([document], subject)).code).toBe(
        guard.code
      );
    }
  });

  it('preserves inherited signatures, super calls and enum dispatch with base fallback', async () => {
    const funcs = await linkedFunctions(`namespace python.dispatch
enum Kind:
 Cash
 Credit
func Compute:
 inputs: kind Kind (1..1) amount number (1..1)
 output: answer number (1..1)
 set answer: amount
func Compute(kind: Kind -> Cash):
 set answer: amount + 1
func Compute(kind: Kind -> Credit):
 set answer: amount + 2
func Parent:
 inputs: amount number (1..1)
 output: answer number (1..1)
 set answer: amount + 1
func Child extends Parent:
 set answer: super(amount) + 2
`);
    const module = generatePythonModule([AstUtils.getDocument(funcs[0]!)]);
    const compute = module.bindings.get('python.dispatch.Compute')!;
    const child = module.bindings.get('python.dispatch.Child')!;
    expect(
      execute(module.code, [
        { expression: `${compute}(data)`, data: { kind: 'Cash', amount: 3 } },
        { expression: `${compute}(data)`, data: { kind: 'Credit', amount: 3 } },
        { expression: `${compute}(data)`, data: { kind: 'Unknown', amount: 3 } },
        { expression: `${child}(data)`, data: { amount: 3 } }
      ])
    ).toEqual([{ value: 4 }, { value: 5 }, { value: 3 }, { value: 6 }]);
  });

  it('keeps a native binding contract visible and rejects execution when no implementation is bound', async () => {
    const funcs = await linkedFunctions(`namespace python.native
func Native:
 inputs: amount number (1..1)
 output: result number (1..1)
 condition Positive: amount > 0
func Call:
 inputs: amount number (1..1)
 output: result number (1..1)
 set result: Native(amount)
`);
    const module = generatePythonModule([AstUtils.getDocument(funcs[0]!)]);
    const name = module.bindings.get('python.native.Call')!;
    const missing = execute(module.code, [{ expression: `${name}(data)`, data: { amount: 2 } }]);
    expect(missing[0]!.error).toContain('Native binding required: python.native.Native');
    expect(execute(module.code, [{ expression: `${name}(data)`, data: { amount: 0 } }])[0]!.error).toContain(
      'Positive'
    );
    expect(
      execute(module.code + '\nrune_bind("python.native.Native", lambda input: input["amount"] * 3)\n', [
        { expression: `${name}(data)`, data: { amount: 2 } }
      ])
    ).toEqual([{ value: 6 }]);
  });

  it('uses collision-safe linked identities for Python keywords, runtime globals and imported calls', async () => {
    const { RuneDsl } = createRuneDslServices();
    const sources = [
      BASICTYPES_ROSETTA,
      `namespace left\nfunc class:\n output: value number (1..1)\n set value: 2\n`,
      `namespace right\nfunc class:\n output: value number (1..1)\n set value: 3\n`,
      `namespace main\nimport left.*\nimport right.*\nfunc rune_list:\n output: value number (1..1)\n set value: left.class() + right.class()\n`
    ];
    const documents = sources.map((source, index) =>
      RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
        source,
        URI.parse(`inmemory:///names-${index}.rosetta`)
      )
    );
    await RuneDsl.shared.workspace.DocumentBuilder.build(documents);
    assertValidDocuments(documents);
    const module = generatePythonModule(documents);
    expect(new Set(module.bindings.values()).size).toBe(module.bindings.size);
    expect([...module.bindings.values()]).not.toContain('class');
    expect([...module.bindings.values()]).not.toContain('rune_list');
    expect(execute(module.code, [{ expression: `${module.bindings.get('main.rune_list')}({})` }])).toEqual([
      { value: 5 }
    ]);
  });

  it('projects Data conditions as typed predicates independent of the reverse lens', async () => {
    const funcs = await linkedFunctions(`namespace python.conditions
type Amount:
 value number (1..1)
 condition Positive: value >= 0
func Identity:
 inputs: amount Amount (1..1)
 output: result Amount (1..1)
 set result: amount
`);
    const document = AstUtils.getDocument(funcs[0]!);
    const module = generatePythonModule([document]);
    const condition = module.projections.find((entry) => entry.kind === 'condition')!;
    expect(condition.code).toContain('data: Amount');
    expect(condition.code).toContain('-> bool:');
    const name = /^def (\w+)/.exec(condition.code)![1]!;
    expect(
      execute(module.code, [
        { expression: `${name}(data)`, data: { value: 0 } },
        { expression: `${name}(data)`, data: { value: -1 } }
      ])
    ).toEqual([{ value: true }, { value: false }]);
  });

  it('counts inherited root fields for a headless one-of condition', async () => {
    const funcs = await linkedFunctions(`namespace python.headless_oneof
type Parent:
 left number (0..1)
type Terms extends Parent:
 right boolean (0..1)
 labels string (0..*)
 condition Selection: one-of
func Identity:
 inputs: terms Terms (1..1)
 output: result Terms (1..1)
 set result: terms
`);
    const document = AstUtils.getDocument(funcs[0]!);
    const python = generatePythonModule([document]);
    const condition = python.projections.find((entry) => entry.kind === 'condition')!;
    const name = /^def (\w+)/.exec(condition.code)![1]!;
    const [typescript] = await generate([document], {
      target: 'typescript',
      strict: true,
      typescript: { layout: 'single-file' }
    });
    const exports: Record<string, new (data: object) => { validateSelection(): { valid: boolean } }> = {};
    const javascript = ts.transpileModule(typescript!.content, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText;
    new Function('require', 'exports', javascript)(createRequire(import.meta.url), exports);
    const cases = [
      { data: {}, expected: false },
      { data: { left: 0 }, expected: true },
      { data: { right: false }, expected: true },
      { data: { labels: [] }, expected: false },
      { data: { labels: [''] }, expected: true },
      { data: { left: 0, right: false }, expected: false },
      { data: { unknown: 1 }, expected: false }
    ];
    const expected = cases.map(({ data, expected }) => {
      const result = new exports.Terms!(data).validateSelection().valid;
      expect(result).toBe(expected);
      return { value: result };
    });
    expect(
      execute(
        python.code,
        cases.map(({ data }) => ({ expression: `${name}(data)`, data }))
      )
    ).toEqual(expected);
  });

  it('rejects a headless one-of on a type with no fields', async () => {
    const funcs = await linkedFunctions(`namespace python.empty_oneof
type Empty:
 condition Selection: one-of
func Anchor:
 output: result number (1..1)
 set result: 0
`);
    const document = AstUtils.getDocument(funcs[0]!);
    const python = generatePythonModule([document]);
    const condition = python.projections.find((entry) => entry.kind === 'condition')!;
    const name = /^def (\w+)/.exec(condition.code)![1]!;
    const [typescript] = await generate([document], {
      target: 'typescript',
      strict: true,
      typescript: { layout: 'single-file' }
    });
    const exports: Record<string, new (data: object) => { validateSelection(): { valid: boolean } }> = {};
    const javascript = ts.transpileModule(typescript!.content, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText;
    new Function('require', 'exports', javascript)(createRequire(import.meta.url), exports);
    expect(new exports.Empty!({}).validateSelection().valid).toBe(false);
    expect(execute(python.code, [{ expression: `${name}(data)`, data: {} }])).toEqual([{ value: false }]);
  });

  it.each(['condition', 'post-condition'])('counts root fields for function %s one-of', async (kind) => {
    const funcs = await linkedFunctions(`namespace python.function_oneof
func Validate:
 inputs: left number (0..1) right boolean (0..1)
 output: result number (0..1)
 ${kind === 'condition' ? 'condition Selection: one-of' : ''}
 set result: 0
 ${kind === 'post-condition' ? 'post-condition Selection: one-of' : ''}
`);
    const document = AstUtils.getDocument(funcs[0]!);
    const python = generatePythonModule([document]);
    const [typescript] = await generate([document], {
      target: 'typescript',
      strict: true,
      typescript: { layout: 'single-file' }
    });
    const exports: Record<string, (data: object) => unknown> = {};
    const javascript = ts.transpileModule(typescript!.content, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText;
    new Function('require', 'exports', javascript)(createRequire(import.meta.url), exports);
    const cases = [{}, { left: 0 }, { right: false }, { left: 0, right: false }];
    const results = execute(
      python.code,
      cases.map((data) => ({
        expression: `${python.bindings.get('python.function_oneof.Validate')}(data)`,
        data
      }))
    );
    cases.forEach((data, index) => {
      const valid = kind === 'condition' ? index === 1 || index === 2 : index === 0;
      if (valid) {
        expect(exports.Validate!(data)).toBe(0);
        expect(results[index]).toEqual({ value: 0 });
      } else {
        expect(() => exports.Validate!(data)).toThrow(/Selection/);
        expect(results[index]?.error).toContain('Selection');
      }
    });
  });

  it('projects bare only-exists fields with inherited siblings in Data condition scope', async () => {
    const funcs = await linkedFunctions(`namespace python.onlyexists
type Parent:
 extra number (0..1)
type Terms extends Parent:
 price number (0..1)
 dividend number (0..1)
 condition ReturnTerms: (price, dividend) only exists
func Identity:
 inputs: terms Terms (1..1)
 output: result Terms (1..1)
 set result: terms
`);
    const module = generatePythonModule([AstUtils.getDocument(funcs[0]!)]);
    const condition = module.projections.find((entry) => entry.kind === 'condition')!;
    const name = /^def (\w+)/.exec(condition.code)![1]!;
    expect(
      execute(module.code, [
        { expression: `${name}(data)`, data: { price: 1, dividend: 2 } },
        { expression: `${name}(data)`, data: { price: 1, dividend: 2, extra: 0 } }
      ])
    ).toEqual([{ value: true }, { value: false }]);
  });

  it('compiles large switches without nesting limits and evaluates only the chosen branch', async () => {
    const arms = Array.from({ length: 260 }, (_, index) => `${index} then ${index === 0 ? 'Fail()' : index}`);
    const funcs = await linkedFunctions(`namespace python.largeswitch
func Fail:
 output: result number (1..1)
func Select:
 inputs: selector number (1..1)
 output: result number (1..1)
 set result: selector switch ${arms.join(', ')}, default Fail()
`);
    const module = generatePythonModule([AstUtils.getDocument(funcs[0]!)]);
    const name = module.bindings.get('python.largeswitch.Select')!;
    const results = execute(module.code, [
      { expression: `${name}(data)`, data: { selector: 1 } },
      { expression: `${name}(data)`, data: { selector: 259 } },
      { expression: `${name}(data)`, data: { selector: 0 } },
      { expression: `${name}(data)`, data: { selector: 999 } }
    ]);
    expect(results.slice(0, 2)).toEqual([{ value: 1 }, { value: 259 }]);
    expect(results[2]!.error).toContain('Native binding required');
    expect(results[3]!.error).toContain('Native binding required');
  });

  it('checks bare only-exists against the actual output local in function postconditions', async () => {
    const funcs = await linkedFunctions(`namespace python.onlyexistslocal
func Validate:
 inputs: price number (0..1)
 output: result number (0..1)
 set result: price
 post-condition Exclusive: price only exists
`);
    const module = generatePythonModule([AstUtils.getDocument(funcs[0]!)]);
    const name = module.bindings.get('python.onlyexistslocal.Validate')!;
    expect(execute(module.code, [{ expression: `${name}(data)`, data: { price: 1 } }])[0]!.error).toContain(
      'Exclusive'
    );
  });

  it('preserves user types when generated input records and metadata type names collide', async () => {
    const funcs = await linkedFunctions(`namespace python.names
type F_Input:
 x number (1..1)
type RuneField:
 y number (1..1)
func F:
 inputs: other F_Input (1..1)
 output: result number (1..1)
 set result: other -> x
`);
    const module = generatePythonModule([AstUtils.getDocument(funcs[0]!)]);
    const name = module.bindings.get('python.names.F')!;
    expect(
      execute(module.code + '\nfrom typing import get_type_hints\n', [
        {
          expression: `list(get_type_hints(get_type_hints(get_type_hints(${name})["input"])["other"]))`
        }
      ])
    ).toEqual([{ value: ['x'] }]);
    expect(module.code).not.toMatch(/^RuneField = TypedDict/m);
  });

  it('preserves absent optional metadata outputs and dispatches on wrapped enum values', async () => {
    const funcs = await linkedFunctions(`namespace python.metadata
annotation metadata:
 scheme string (0..1)
metaType scheme string
enum Kind:
 Cash
 Credit
func Label:
 inputs: text string (0..1)
 output: result string (0..1)
  [metadata scheme]
 set result: text
func Compute:
 inputs: kind Kind (0..1)
  [metadata scheme]
 output: result number (1..1)
 set result: 0
func Compute(kind: Kind -> Cash):
 set result: 1
func Compute(kind: Kind -> Credit):
 set result: 2
`);
    const module = generatePythonModule([AstUtils.getDocument(funcs[0]!)]);
    const label = module.bindings.get('python.metadata.Label')!,
      compute = module.bindings.get('python.metadata.Compute')!;
    expect(module.code).toContain('RuneField[Kind]');
    expect(
      execute(module.code, [
        { expression: `${label}(data)`, data: {} },
        { expression: `${label}(data)`, data: { text: '' } },
        { expression: `${compute}(data)`, data: { kind: { value: 'Cash', meta: { scheme: 'x' } } } },
        { expression: `${compute}(data)`, data: { kind: { value: 'Credit', meta: { scheme: 'x' } } } }
      ])
    ).toEqual([{ value: null }, { value: { value: '', meta: {} } }, { value: 1 }, { value: 2 }]);
  });

  it.each(['scheme', 'reference'])('normalizes JSON Data %s envelopes once at every input boundary', async (kind) => {
    const { python, exports, document } = await executableFunctions(`namespace python.data_envelopes
annotation metadata:
 scheme string (0..1)
 reference string (0..1)
metaType scheme string
metaType reference string
type Token:
 value number (1..1)
 externalReference string (0..1)
type Parent:
 amount number (0..1)
type Payload extends Parent:
 token Token (0..1)
  [metadata reference]
typeAlias PayloadAlias: Payload
func Read:
 inputs: object PayloadAlias (0..1)
  [metadata ${kind}]
 output: result number (0..*)
 set result: object -> amount
func Forward:
 inputs: objects PayloadAlias (0..*)
  [metadata ${kind}]
 output: result PayloadAlias (0..*)
  [metadata ${kind}]
 set result: objects
func ReadTokens:
 inputs: objects PayloadAlias (0..*)
  [metadata ${kind}]
 output: result number (0..*)
 set result: objects -> token -> value
`);
    const cases = [
      { value: { amount: 1 }, meta: { scheme: 'external' } },
      { value: { amount: 0 }, meta: {} },
      { value: { amount: 2 } },
      ...(kind === 'reference'
        ? [{ externalReference: 'id', globalReference: 'global', reference: { reference: 'scoped' } }]
        : [])
    ];
    const nested = {
      objects: [{ value: { amount: 3, token: { value: { value: 7, externalReference: 'raw' }, meta: {} } }, meta: {} }]
    };
    const data = { objects: cases };
    for (const [target, input] of [
      ['Read', { object: cases[0] }],
      ['Forward', data],
      ['ReadTokens', nested]
    ] as const) {
      expect(
        normalizePreviewInputs([document], `python.data_envelopes.${target}`, input, {
          field: (value) => ({ value }),
          reference: (value) => ({ value })
        })
      ).toEqual(input);
    }
    const amounts = kind === 'reference' ? [[1], [0], [2], []] : [[1], [0], [2]];
    expect(cases.map((object) => exports.Read!({ object }))).toEqual(amounts);
    expect(
      execute(
        python.code,
        cases.map((object) => ({ expression: 'Read(data)', data: { object } }))
      )
    ).toEqual(amounts.map((value) => ({ value })));
    expect(exports.Forward!(data)).toEqual(cases);
    expect(execute(python.code, [{ expression: 'Forward(data)', data }])).toEqual([{ value: cases }]);
    expect(exports.ReadTokens!(nested)).toEqual([7]);
    expect(execute(python.code, [{ expression: 'ReadTokens(data)', data: nested }])).toEqual([{ value: [7] }]);
  });

  it.each(['own', 'inherited'])(
    'treats Data value fields and %s type metadata as payloads, including aliases and arrays',
    async (placement) => {
      const funcs = await linkedFunctions(`namespace python.rawPayload
annotation metadata:
 scheme string (0..1)
 reference string (0..1)
 key string (0..1)
metaType scheme string
metaType reference string
metaType key string
type Parent:
 ${placement === 'inherited' ? '[metadata key]' : ''}
type Payload extends Parent:
 ${placement === 'own' ? '[metadata key]' : ''}
 value number (1..1)
 externalReference string (0..1)
typeAlias PayloadAlias: Payload
func Read:
 inputs: object PayloadAlias (1..1)
  [metadata scheme]
 output: result number (1..1)
 set result: object -> value
func Forward:
 inputs: object PayloadAlias (1..1)
  [metadata scheme]
 output: result number (1..1)
 set result: Read(object)
func ReadMany:
 inputs: objects Payload (0..*)
  [metadata reference]
 output: result number (0..*)
 set result: objects extract [value]
`);
      const doc = AstUtils.getDocument(funcs[0]!);
      const module = generatePythonModule([doc]);
      const data = { object: { value: 1, externalReference: 'ordinary field', meta: { externalKey: 'payload-key' } } };
      expect(
        normalizePreviewInputs([doc], 'python.rawPayload.Read', data, {
          field: (value) => ({ value }),
          reference: (value) => ({ value })
        })
      ).toEqual({ object: { value: data.object } });
      const envelope = { object: { value: data.object } };
      expect(
        normalizePreviewInputs([doc], 'python.rawPayload.Read', envelope, {
          field: (value) => ({ value }),
          reference: (value) => ({ value })
        })
      ).toEqual(envelope);
      expect(
        execute(module.code, [
          { expression: `${module.bindings.get('python.rawPayload.Read')}(data)`, data },
          { expression: `${module.bindings.get('python.rawPayload.Forward')}(data)`, data },
          {
            expression: `${module.bindings.get('python.rawPayload.Read')}(data)`,
            data: { object: { value: data.object } }
          },
          {
            expression: `${module.bindings.get('python.rawPayload.Read')}(dict(object=rune.toField(data["object"])))`,
            data
          },
          {
            expression: `${module.bindings.get('python.rawPayload.ReadMany')}(data)`,
            data: { objects: [{ value: 0 }, { value: 2 }] }
          }
        ])
      ).toEqual([{ value: 1 }, { value: 1 }, { value: 1 }, { value: 1 }, { value: [0, 2] }]);
    }
  );

  it('normalizes raw metadata inputs before choosing a dispatch branch', async () => {
    const funcs = await linkedFunctions(`namespace python.dispatchRaw
annotation metadata:
 scheme string (0..1)
metaType scheme string
enum Kind:
 Cash
func Compute:
 inputs: kind Kind (0..1)
  [metadata scheme]
 output: result number (1..1)
 set result: 0
func Compute(kind: Kind -> Cash):
 set result: 1
`);
    const module = generatePythonModule([AstUtils.getDocument(funcs[0]!)]);
    expect(
      execute(module.code, [
        { expression: `${module.bindings.get('python.dispatchRaw.Compute')}(data)`, data: { kind: 'Cash' } }
      ])
    ).toEqual([{ value: 1 }]);
  });

  it('keeps linked collection-path writes within declared bounds and normalizes numeric inputs', async () => {
    const funcs = await linkedFunctions(`namespace python.bounds
type Child:
 values number (0..2)
type Outer:
 children Child (0..*)
func Build:
 inputs: values number (0..*)
 output: result Outer (1..1)
 set result -> children -> values: values
 add result -> children -> values: 3
func Precise:
 inputs: number number (1..1)
 output: result boolean (1..1)
 set result: number + 1 = number
`);
    const module = generatePythonModule([AstUtils.getDocument(funcs[0]!)]);
    const build = module.bindings.get('python.bounds.Build')!,
      precise = module.bindings.get('python.bounds.Precise')!;
    const outputs = execute(module.code, [
      { expression: `${build}(data)`, data: { values: [1] } },
      { expression: `${build}(data)`, data: { values: [1, 2] } },
      { expression: `${precise}(data)`, data: { number: 9007199254740992 } }
    ]);
    expect(outputs[0]).toEqual({ value: { children: [{ values: [1, 3] }] } });
    expect(outputs[1]!.error).toContain('too many');
    expect(outputs[2]).toEqual({ value: true });
  });
});

describe('pinned CDM Python backend execution', () => {
  let outputs: Array<{ value?: unknown; error?: string }>;
  let documents: LangiumDocument[];
  let module: ReturnType<typeof generatePythonModule>;
  beforeAll(async () => {
    const { RuneDsl } = createRuneDslServices();
    documents = referenceFiles().map(({ uri, content }) =>
      RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(content, URI.parse(uri))
    );
    await RuneDsl.shared.workspace.DocumentBuilder.build(documents, { validation: false });
    assertValidDocuments(documents);
    module = generatePythonModule(documents);
    outputs = execute(
      module.code,
      referenceCases.map((testCase) => ({
        expression: `${module.bindings.get(testCase.function)}(data)`,
        data: testCase.inputs
      }))
    );
  });
  it('matches the CDM UnitType one-of predicate for absent and multiple fields', async () => {
    const projection = module.projections.find((entry) => entry.code.includes('data: UnitType)'))!;
    const name = /^def (\w+)/.exec(projection.code)![1]!;
    const [typescript] = await generate(documents, {
      target: 'typescript',
      strict: true,
      typescript: { layout: 'single-file' }
    });
    const exports: Record<string, new (data: object) => { validateUnitType(): { valid: boolean } }> = {};
    const javascript = ts.transpileModule(typescript!.content, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText;
    new Function('require', 'exports', javascript)(createRequire(import.meta.url), exports);
    const cases = [
      { data: {}, expected: false },
      { data: { financialUnit: 'Share' }, expected: true },
      { data: { currency: { value: 'USD', meta: {} } }, expected: true },
      { data: { financialUnit: 'Share', currency: { value: 'USD', meta: {} } }, expected: false }
    ];
    const expected = cases.map(({ data, expected }) => {
      const result = new exports.UnitType!(data).validateUnitType().valid;
      expect(result).toBe(expected);
      return { value: result };
    });
    expect(
      execute(
        module.code,
        cases.map(({ data }) => ({ expression: `${name}(data)`, data }))
      )
    ).toEqual(expected);
  });
  it.each(referenceCases)('$id ($function)', (testCase) => {
    const output = outputs[referenceCases.indexOf(testCase)]!;
    if (testCase.expectedError) expect(output.error).toContain(testCase.expectedError);
    else {
      expect(output.error).toBeUndefined();
      const expected = testCase.knownDifference?.expectedRune ?? testCase.expected;
      if (testCase.absoluteTolerance)
        expect(Math.abs(Number(output.value) - Number(expected))).toBeLessThanOrEqual(testCase.absoluteTolerance);
      else expect(output.value).toEqual(expected);
    }
  });
});
