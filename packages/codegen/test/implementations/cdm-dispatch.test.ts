// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { URI, type LangiumDocument } from 'langium';
import { createRuneDslServices, assertValidDocuments, isRosettaModel, isRosettaFunction } from '@rune-langium/core';
import { Temporal } from '@js-temporal/polyfill';
import { generateSelected } from '../../src/export.js';
import { generatePythonModule } from '../../src/projection/python-functions.js';
import { referenceFiles } from '../helpers/cdm-reference.js';
import { compileGeneratedTypeScript } from '../helpers/compiled-typescript.js';
import { runPython } from '../projection/python-test-utils.js';
import { installPublishedNativeImplementations } from '../../../../test/helpers/curated-implementations.js';

const directory = resolve(import.meta.dirname, '../../../../test/fixtures/third-party/cdm-dispatch');
interface Case {
  id: string;
  function: string;
  selector: string;
  startDate?: string;
  endDate?: string;
  terminationDate?: string;
  periodsInYear?: number;
  expected?: number;
  expectedError?: boolean;
  nonFinite?: boolean;
}
const cases: Case[] = JSON.parse(readFileSync(resolve(directory, 'cases.json'), 'utf8'));
let docs: LangiumDocument[];
beforeAll(async () => {
  const { RuneDsl } = createRuneDslServices();
  docs = referenceFiles(directory).map((file) =>
    RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(file.content, URI.parse(file.uri))
  );
  await RuneDsl.shared.workspace.DocumentBuilder.build(docs, { eagerLinking: true });
  assertValidDocuments(docs);
  installPublishedNativeImplementations(docs);
});
const args = (test: Case) =>
  test.function === 'DayCountBasis'
    ? [test.selector]
    : [
        test.selector,
        Temporal.PlainDate.from(test.startDate!),
        Temporal.PlainDate.from(test.endDate!),
        test.terminationDate ? Temporal.PlainDate.from(test.terminationDate) : undefined,
        test.periodsInYear
      ];

it('covers every pinned selector body and verifies the preserved handwritten Java reference bytes', () => {
  for (const name of ['DayCountBasis', 'YearFraction']) {
    const selectors = docs
      .flatMap((doc) =>
        isRosettaModel(doc.parseResult.value) ? doc.parseResult.value.elements.filter(isRosettaFunction) : []
      )
      .filter((fn) => fn.name === name && fn.dispatchValue && fn.operations.length)
      .map((fn) => fn.dispatchValue!.value.$refText);
    expect(
      new Set(cases.filter((test) => test.function === name && !test.expectedError).map((test) => test.selector))
    ).toEqual(new Set(selectors));
  }
  const manifest: { references: { name: string; sha256: string }[] } = JSON.parse(
    readFileSync(resolve(directory, 'sources.json'), 'utf8')
  );
  expect(manifest.references.filter((asset) => asset.name.endsWith('.java'))).toHaveLength(4);
  for (const asset of manifest.references)
    expect(
      createHash('sha256')
        .update(readFileSync(resolve(directory, asset.name)))
        .digest('hex')
    ).toBe(asset.sha256);
});

it.each(['single-file', 'per-namespace', 'barrel'] as const)(
  'strictly compiles and executes the pinned dispatch closure in %s TypeScript',
  async (layout) => {
    const selected = await generateSelected(
      docs,
      { namespaces: ['cdm.base.datetime.daycount'], declarations: [] },
      { target: 'typescript', strict: true, typescript: { layout } }
    );
    expect(
      selected.outputs.flatMap((output) => output.diagnostics).filter((issue) => issue.severity === 'error')
    ).toEqual([]);
    const functions = selected.outputs.flatMap((output) => output.funcs);
    const fn = functions.find((fn) => fn.name === 'YearFraction')!;
    const entry = selected.outputs.find((output) => output.funcs.includes(fn))!.relativePath;
    const module = compileGeneratedTypeScript(selected.outputs, { entry });
    for (const test of cases) {
      const fn = functions.find((fn) => fn.name === test.function)!;
      const invoke = () => module[fn.exportName!]!(...args(test));
      if (test.expectedError) expect(invoke, test.id).toThrow(/implementation|implemented|unavailable|requires|result/);
      else if (test.nonFinite) expect(Number.isFinite(invoke()), test.id).toBe(false);
      else expect(invoke(), test.id).toBeCloseTo(test.expected!, 12);
    }
  }
);

it('executes the same selector/optional/signed boundary cases in standalone Python', () => {
  const python = generatePythonModule(docs);
  expect(python.diagnostics.filter((issue) => issue.severity === 'error')).toEqual([]);
  const results = runPython(
    cases.map((test) => {
      const values =
        test.function === 'DayCountBasis'
          ? [test.selector]
          : [test.selector, test.startDate, test.endDate, test.terminationDate, test.periodsInYear];
      return {
        expression: `${python.bindings.get('cdm.base.datetime.daycount.' + test.function)}(${values.map((value) => (value === undefined ? 'None' : JSON.stringify(value))).join(',')})`
      };
    }),
    python.code,
    { includeRuntime: false }
  );
  for (const [index, test] of cases.entries()) {
    if (test.expectedError)
      expect(results[index], test.id).toMatchObject({
        error: expect.stringMatching(/implementation|implemented|unavailable|requires|result|binding required/)
      });
    else if (test.nonFinite) expect(results[index], test.id).toEqual({ value: null });
    else expect(results[index], test.id).toMatchObject({ value: expect.closeTo(test.expected!, 12) });
  }
});
