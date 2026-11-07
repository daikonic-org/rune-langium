// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { beforeAll, expect, it } from 'vitest';
import { URI } from 'langium';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Temporal } from '@js-temporal/polyfill';
import { createRuneDslServices, assertValidDocuments, isRosettaModel, isRosettaFunction } from '@rune-langium/core';
import { generateSelected, generatePreviewSchemas } from '../../src/export.js';
import { generatePythonModule } from '../../src/projection/python-functions.js';
import { compileGeneratedTypeScript } from '../helpers/compiled-typescript.js';
import { runPython } from '../projection/python-test-utils.js';
import { installPublishedNativeImplementations } from '../../../../test/helpers/curated-implementations.js';
import {
  calculationPeriodCases,
  calculationPeriodDirectory,
  calculationPeriodIdentity,
  calculationPeriodFiles,
  calculationPeriodCaller
} from '../../../../test/helpers/cdm-calculation-period.js';

async function documents(withCalendars = true) {
  const { RuneDsl } = createRuneDslServices();
  await RuneDsl.shared.workspace.WorkspaceManager.initializeWorkspace([]);
  const docs = [
    ...calculationPeriodFiles(withCalendars),
    { uri: 'file:///model/calculation.rosetta', content: calculationPeriodCaller }
  ].map(({ uri, content }) => RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(content, URI.parse(uri)));
  for (const doc of docs) RuneDsl.shared.workspace.LangiumDocuments.addDocument(doc);
  await RuneDsl.shared.workspace.DocumentBuilder.build(docs, { eagerLinking: true });
  assertValidDocuments(docs);
  installPublishedNativeImplementations(docs);
  return docs;
}

let docs: Awaited<ReturnType<typeof documents>>;
beforeAll(async () => {
  docs = await documents();
});

it.each(['single-file', 'per-namespace', 'barrel'] as const)(
  'retains transitive dispatch bodies for a selected caller in %s',
  async (layout) => {
    const selected = await generateSelected(
      docs,
      {
        namespaces: [],
        declarations: [{ namespace: 'example.calculation', name: 'FixingPeriod', kind: 'RosettaFunction' }]
      },
      { target: 'typescript', strict: true, typescript: { layout } }
    );
    const fn = selected.outputs.flatMap((output) => output.funcs).find((fn) => fn.name === 'FixingPeriod')!;
    const output = selected.outputs.find((output) => output.funcs.includes(fn))!;
    const module = compileGeneratedTypeScript(selected.outputs, { entry: output.relativePath });
    expect(
      JSON.parse(
        JSON.stringify(
          module[fn.exportName!]!(Temporal.PlainDate.from('2024-03-01'), Temporal.PlainDate.from('2024-03-08'), 1)
        )
      )
    ).toEqual({ adjustedStartDate: '2024-03-06', adjustedEndDate: '2024-03-11' });
    const python = generatePythonModule(selected.selection.documents);
    expect(
      runPython(
        [{ expression: `${python.bindings.get('example.calculation.FixingPeriod')}('2024-03-01','2024-03-08',1)` }],
        python.code,
        { includeRuntime: false }
      )
    ).toEqual([{ value: { adjustedStartDate: '2024-03-06', adjustedEndDate: '2024-03-11' } }]);
  }
);

function nativeInput(value: unknown): unknown {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return Temporal.PlainDate.from(value);
  if (Array.isArray(value)) return value.map(nativeInput);
  if (typeof value === 'object' && value !== null)
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, nativeInput(child)]));
  return value;
}

it('covers every original selector and verifies handwritten Java test provenance', () => {
  const selectors = docs
    .flatMap((doc) =>
      isRosettaModel(doc.parseResult.value) ? doc.parseResult.value.elements.filter(isRosettaFunction) : []
    )
    .filter((fn) => fn.name === 'ComputeCalculationPeriod' && fn.dispatchValue && fn.operations.length)
    .map((fn) => fn.dispatchValue!.value.$refText);
  expect(
    new Set(calculationPeriodCases.filter((test) => !test.expectedError).map((test) => test.inputs.calculateRelativeTo))
  ).toEqual(new Set(selectors));
  const manifest: { references: { name: string; sha256: string }[] } = JSON.parse(
    readFileSync(resolve(calculationPeriodDirectory, 'sources.json'), 'utf8')
  );
  expect(manifest.references.filter((asset) => asset.name.endsWith('.java'))).toHaveLength(3);
  for (const asset of manifest.references)
    expect(
      createHash('sha256')
        .update(readFileSync(resolve(calculationPeriodDirectory, asset.name)))
        .digest('hex')
    ).toBe(asset.sha256);
});

it.each(['single-file', 'per-namespace', 'barrel'] as const)(
  'executes the original calculation-period closure in strict %s TypeScript',
  async (layout) => {
    const selected = await generateSelected(
      docs,
      {
        namespaces: [],
        declarations: [
          {
            namespace: 'cdm.observable.asset.calculatedrate',
            name: 'ComputeCalculationPeriod',
            kind: 'RosettaFunction'
          }
        ]
      },
      { target: 'typescript', strict: true, typescript: { layout } }
    );
    const fn = selected.outputs.flatMap((output) => output.funcs).find((fn) => fn.name === 'ComputeCalculationPeriod')!;
    const output = selected.outputs.find((output) => output.funcs.includes(fn))!;
    const module = compileGeneratedTypeScript(selected.outputs, { entry: output.relativePath });
    for (const test of calculationPeriodCases) {
      const inputs = fn.parameterNames.map((name) => nativeInput(test.inputs[name]));
      const unchanged = JSON.stringify(inputs);
      const invoke = () => module[fn.exportName!]!(...inputs);
      if (test.expectedError) expect(invoke, test.id).toThrow(new RegExp(test.expectedError, 'i'));
      else expect(JSON.parse(JSON.stringify(invoke())), test.id).toEqual(test.expected);
      expect(JSON.stringify(inputs), test.id).toBe(unchanged);
    }
  }
);

it('executes the same calculation-period inputs in standalone Python', () => {
  const python = generatePythonModule(docs);
  const fn = python.bindings.get(calculationPeriodIdentity)!;
  const results = runPython(
    calculationPeriodCases.map((test) => ({ expression: `${fn}(data)`, data: test.inputs })),
    python.code,
    { includeRuntime: false }
  );
  for (const [index, test] of calculationPeriodCases.entries()) {
    if (test.expectedError)
      expect(results[index], test.id).toMatchObject({
        error: expect.stringMatching(new RegExp(test.expectedError, 'i'))
      });
    else expect(results[index], test.id).toEqual({ value: test.expected });
  }
});

it('retains unavailable calendar diagnostics when the explicit provider is absent', async () => {
  const missing = await documents(false);
  const schemas = generatePreviewSchemas(missing);
  const provider = schemas.find((schema) => schema.targetId === 'cdm.base.datetime.BusinessCenterHolidays');
  expect(provider).toBeDefined();
  expect(provider?.executionUnavailable).toBeTruthy();
  const python = generatePythonModule(missing);
  const fn = python.bindings.get(calculationPeriodIdentity)!;
  const results = runPython(
    calculationPeriodCases.slice(0, 3).map((test) => ({ expression: `${fn}(data)`, data: test.inputs })),
    python.code,
    { includeRuntime: false }
  );
  expect(results.slice(0, 2)).toEqual(calculationPeriodCases.slice(0, 2).map((test) => ({ value: test.expected })));
  expect(results[2]).toHaveProperty('error');
});
