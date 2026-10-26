// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { beforeAll, afterEach, expect, it, vi } from 'vitest';
import { URI, type LangiumDocument } from 'langium';
import {
  ANNOTATIONS_ROSETTA,
  BASICTYPES_ROSETTA,
  assertValidDocuments,
  createRuneDslServices,
  isRosettaFunction,
  isRosettaModel,
  type RosettaFunction
} from '@rune-langium/core';
import { Temporal } from '@js-temporal/polyfill';
import { generate, generatePreviewSchemas, generateSelected } from '../../src/export.js';
import { resolveNativeImplementation } from '../../src/implementations/index.js';
import { generatePythonModule } from '../../src/projection/python-functions.js';
import { bindGeneratedProjectModule, createProjectBindingRegistry } from '../../src/runtime/project-bindings.js';
import { compileGeneratedTypeScript } from '../helpers/compiled-typescript.js';
import { runPython } from '../projection/python-test-utils.js';

const nativeSource = `namespace cdm.base.datetime
func Today:
 [codeImplementation]
 output: today date (1..1)
 post-condition Present: today exists
`;
const caller = `namespace example.clock
import cdm.base.datetime.*
func ReadToday:
 output: result date (1..1)
 set result: Today()
`;

async function documents(source = nativeSource): Promise<LangiumDocument[]> {
  const { RuneDsl } = createRuneDslServices();
  const docs = [BASICTYPES_ROSETTA, ANNOTATIONS_ROSETTA, source, caller].map((text, index) =>
    RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(text, URI.parse(`inmemory:///native-${index}.rosetta`))
  );
  await RuneDsl.shared.workspace.DocumentBuilder.build(docs);
  expect(docs.flatMap((doc) => doc.parseResult.parserErrors)).toEqual([]);
  assertValidDocuments(docs);
  return docs;
}

let docs: LangiumDocument[], today: RosettaFunction;
beforeAll(async () => {
  docs = await documents();
  const model = docs[2]!.parseResult.value;
  if (!isRosettaModel(model)) throw new Error('Expected model');
  today = model.elements.find(isRosettaFunction)!;
});
afterEach(() => vi.useRealTimers());

it('matches the full identity, annotation and signature, with explicit target support', () => {
  expect(resolveNativeImplementation(today, 'typescript')).toMatchObject({ status: 'available', id: 'cdm.utc-today' });
  expect(resolveNativeImplementation(today, 'python')).toMatchObject({ status: 'available' });
  for (const target of ['java', 'toString', '__proto__'])
    expect(resolveNativeImplementation(today, target)).toMatchObject({ status: 'unsupported' });
  expect(resolveNativeImplementation({ ...today, name: 'Yesterday' }, 'typescript')).toMatchObject({
    status: 'unsupported'
  });
  expect(resolveNativeImplementation({ ...today, annotations: [] }, 'typescript')).toBeUndefined();
  expect(resolveNativeImplementation({ ...today, inputs: [today.output!] }, 'typescript')).toMatchObject({
    status: 'unsupported'
  });
  expect(
    resolveNativeImplementation({ ...today, output: { ...today.output!, name: 'other' } }, 'typescript')
  ).toMatchObject({ status: 'unsupported' });
  expect(
    resolveNativeImplementation(
      { ...today, output: { ...today.output!, card: { ...today.output!.card, inf: 0 } } },
      'typescript'
    )
  ).toMatchObject({ status: 'unsupported' });
  expect(
    resolveNativeImplementation(
      { ...today, $container: { ...today.$container, name: 'other.namespace' } },
      'typescript'
    )
  ).toMatchObject({ status: 'unsupported' });
});

it.each(['single-file', 'per-namespace'] as const)(
  'executes standalone TypeScript with %s layout and UTC date values',
  async (layout) => {
    const generated = await generateSelected(
      docs,
      { namespaces: ['example.clock'], declarations: [] },
      {
        target: 'typescript',
        strict: true,
        typescript: { layout }
      }
    );
    expect(
      generated.outputs.flatMap((output) => output.diagnostics).filter((issue) => issue.code === 'abstract-func')
    ).toEqual([]);
    const fn = generated.outputs.flatMap((output) => output.funcs).find((fn) => fn.name === 'ReadToday')!;
    const entry = generated.outputs.find((output) => output.funcs.includes(fn))!.relativePath;
    const exports = compileGeneratedTypeScript(generated.outputs, { entry });
    const read = exports[fn.exportName!] as () => Temporal.PlainDate;
    vi.useFakeTimers();
    for (const [instant, expected] of [
      ['2024-02-29T23:59:59Z', '2024-02-29'],
      ['2024-03-01T00:00:00Z', '2024-03-01'],
      ['2024-12-31T23:30:00-02:00', '2025-01-01']
    ]) {
      vi.setSystemTime(new Date(instant!));
      const value = read();
      expect(Object.prototype.toString.call(value)).toBe('[object Temporal.PlainDate]');
      expect(value.toString()).toBe(expected);
    }
  }
);

it('emits standalone Python using the same UTC semantics and canonical ISO date representation', () => {
  const python = generatePythonModule(docs);
  expect(python.diagnostics).toEqual([]);
  const read = python.bindings.get('example.clock.ReadToday')!;
  const clock = `
class _TestClock(datetime):
    @classmethod
    def now(cls, tz=None):
        return cls.fromisoformat(_test_instant).astimezone(tz)
datetime = _TestClock
`;
  expect(
    runPython(
      [
        { expression: `(globals().__setitem__('_test_instant', '2024-02-29T23:59:59+00:00'), ${read}())[1]` },
        { expression: `(globals().__setitem__('_test_instant', '2024-03-01T00:00:00+00:00'), ${read}())[1]` },
        { expression: `(globals().__setitem__('_test_instant', '2024-12-31T23:30:00-02:00'), ${read}())[1]` },
        { expression: `isinstance(${read}(), str)` }
      ],
      python.code + clock,
      { includeRuntime: false }
    )
  ).toEqual([{ value: '2024-02-29' }, { value: '2024-03-01' }, { value: '2025-01-01' }, { value: true }]);
});

it('keeps preview availability consistent with executable generation', () => {
  const preview = generatePreviewSchemas(docs).find((schema) => schema.targetId === 'cdm.base.datetime.Today');
  expect(preview?.executionUnavailable).toBeUndefined();
});

it('keeps explicit Python bindings ahead of the bundled fallback', () => {
  const python = generatePythonModule(docs);
  expect(
    runPython(
      [{ expression: `${python.bindings.get('example.clock.ReadToday')}()` }],
      python.code + `\nrune.bind('cdm.base.datetime.Today', lambda: '2000-01-02')\n`,
      { includeRuntime: false }
    )
  ).toEqual([{ value: '2000-01-02' }]);
});

it.each(['condition Blocked: False\n', 'post-condition Blocked: False\n'])(
  'retains native function guards: %s',
  async (condition) => {
    const guarded = await documents(nativeSource.replace(' post-condition Present: today exists\n', ` ${condition}`));
    const outputs = await generate(guarded, { target: 'typescript', typescript: { layout: 'single-file' } });
    const exports = compileGeneratedTypeScript(outputs);
    const fn = outputs.flatMap((output) => output.funcs).find((fn) => fn.name === 'ReadToday')!;
    expect(() => (exports[fn.exportName!] as () => unknown)()).toThrow(/Blocked/);
    const python = generatePythonModule(guarded);
    expect(
      runPython([{ expression: `${python.bindings.get('example.clock.ReadToday')}()` }], python.code, {
        includeRuntime: false
      })
    ).toEqual([{ error: 'Diagnostic: Blocked' }]);
  }
);

it('lets explicit project host bindings take precedence over bundled TypeScript bodies', async () => {
  const symbol = { model: 'cdm', namespace: 'cdm.base.datetime', kind: 'RosettaFunction', name: 'Today' };
  const outputs = await generate(docs, {
    target: 'typescript',
    typescript: { layout: 'single-file' },
    projectBindings: new Map([[today, symbol]])
  });
  const exports = compileGeneratedTypeScript(outputs);
  const fn = outputs.flatMap((output) => output.funcs).find((fn) => fn.name === 'ReadToday')!;
  const read = exports[fn.exportName!] as () => Temporal.PlainDate;
  expect(() => read()).toThrow(/Bind the installed runtime/);
  bindGeneratedProjectModule(
    exports,
    createProjectBindingRegistry({ implementations: [{ symbol, invoke: () => Temporal.PlainDate.from('2000-01-02') }] })
  );
  expect(read().toString()).toBe('2000-01-02');
});

it('preserves authored Rune bodies in both backends', async () => {
  const authored = await documents(
    nativeSource.replace(' post-condition', ' set today: date {year: 2001, month: 2, day: 3}\n post-condition')
  );
  const outputs = await generate(authored, { target: 'typescript', typescript: { layout: 'single-file' } });
  const exports = compileGeneratedTypeScript(outputs);
  const fn = outputs.flatMap((output) => output.funcs).find((fn) => fn.name === 'ReadToday')!;
  expect((exports[fn.exportName!] as () => Temporal.PlainDate)().toString()).toBe('2001-02-03');
  const python = generatePythonModule(authored);
  expect(
    runPython([{ expression: `${python.bindings.get('example.clock.ReadToday')}()` }], python.code, {
      includeRuntime: false
    })
  ).toEqual([{ value: '2001-02-03' }]);
});

it('reports missing implementations and never silently executes a mismatched signature', async () => {
  const unsupported = await documents(nativeSource.replace('today date (1..1)', 'today date (0..1)'));
  const outputs = await generate(unsupported, { target: 'typescript', typescript: { layout: 'single-file' } });
  expect(outputs.flatMap((output) => output.diagnostics)).toContainEqual(
    expect.objectContaining({ code: 'native-implementation-unavailable' })
  );
  expect(generatePythonModule(unsupported).diagnostics).toContainEqual(
    expect.objectContaining({ code: 'native-implementation-unavailable' })
  );
  expect(
    generatePreviewSchemas(unsupported).find((schema) => schema.targetId === 'cdm.base.datetime.Today')
      ?.executionUnavailable
  ).toBeTruthy();
  const schemas = await generate(unsupported, { target: 'json-schema', strict: true });
  expect(
    schemas
      .flatMap((output) => output.diagnostics)
      .filter((issue) => issue.code === 'native-implementation-unavailable')
  ).toEqual([]);
});
