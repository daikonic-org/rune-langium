// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { beforeAll, expect, it } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { URI, type LangiumDocument } from 'langium';
import { assertValidDocuments, createRuneDslServices } from '@rune-langium/core';
import { periodRangeCases, periodRangeFiles } from '../../../../test/helpers/cdm-period-range.js';
import { GENERATED_MODULE_TEST_TIMEOUT } from '../../../../test/helpers/vitest-budget.js';
import { generateSelected } from '../../src/export.js';
import { generatePythonModule } from '../../src/projection/python-functions.js';
import { compileGeneratedTypeScript } from '../helpers/compiled-typescript.js';
import { runPython } from '../projection/python-test-utils.js';

let docs: LangiumDocument[];
const codeListWarning = expect.objectContaining({
  code: 'native-implementation-unavailable',
  severity: 'warning',
  message: expect.stringContaining('cdm.base.staticdata.codelist.LoadCodeList')
});

beforeAll(async () => {
  const { RuneDsl } = createRuneDslServices();
  await RuneDsl.shared.workspace.WorkspaceManager.initializeWorkspace([]);
  docs = periodRangeFiles().map(({ uri, content }) =>
    RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(content, URI.parse(uri))
  );
  for (const doc of docs) RuneDsl.shared.workspace.LangiumDocuments.addDocument(doc);
  await RuneDsl.shared.workspace.DocumentBuilder.build(docs, { eagerLinking: true });
  assertValidDocuments(docs);
});

it.each(['single-file', 'per-namespace', 'barrel'] as const)(
  'matches the handwritten range constructor through the workspace override in strict %s TypeScript',
  async (layout) => {
    const selected = await generateSelected(
      docs,
      { namespaces: ['example.periodrange'], declarations: [] },
      { target: 'typescript', strict: true, typescript: { layout } }
    );
    expect(selected.outputs.flatMap((file) => file.diagnostics)).toEqual([codeListWarning]);
    const file = selected.outputs.find((output) => output.funcs.some((fn) => fn.name === 'BuildPeriodRange'))!;
    const module = compileGeneratedTypeScript(selected.outputs, { entry: file.relativePath });
    const range = module[file.funcs.find((fn) => fn.name === 'BuildPeriodRange')!.exportName!]!;
    for (const test of periodRangeCases) {
      const { startDate, endDate, dateAdjustments } = test.inputs;
      const invoke = () =>
        range(
          startDate === undefined ? undefined : Temporal.PlainDate.from(startDate),
          endDate === undefined ? undefined : Temporal.PlainDate.from(endDate),
          dateAdjustments
        );
      if (test.expectedError) expect(invoke, test.id).toThrow(test.expectedError);
      else expect(JSON.parse(JSON.stringify(invoke())), test.id).toEqual(test.expected);
    }
    const bounds = module[file.funcs.find((fn) => fn.name === 'RangeBounds')!.exportName!]!;
    expect(
      JSON.parse(JSON.stringify(bounds(Temporal.PlainDate.from('2024-02-28'), Temporal.PlainDate.from('2024-03-01'))))
    ).toEqual({
      adjustedStartDate: '2024-02-28',
      adjustedEndDate: '2024-03-01'
    });
  },
  GENERATED_MODULE_TEST_TIMEOUT
);

it('executes the same range cases and upstream period adapter in standalone Python', () => {
  const python = generatePythonModule(docs);
  expect(python.diagnostics).toEqual([codeListWarning]);
  const range = python.bindings.get('example.periodrange.BuildPeriodRange')!;
  const bounds = python.bindings.get('example.periodrange.RangeBounds')!;
  expect(
    runPython(
      [
        ...periodRangeCases.map((test) => ({ expression: `${range}(data)`, data: test.inputs })),
        { expression: `${bounds}('2024-02-28', '2024-03-01')` }
      ],
      python.code,
      { includeRuntime: false }
    )
  ).toEqual([
    ...periodRangeCases.map((test) =>
      test.expectedError ? { error: expect.stringContaining(test.expectedError) } : { value: test.expected }
    ),
    { value: { adjustedStartDate: '2024-02-28', adjustedEndDate: '2024-03-01' } }
  ]);
});
