// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { beforeAll, expect, it } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { URI, type LangiumDocument } from 'langium';
import { assertValidDocuments, createRuneDslServices } from '@rune-langium/core';
import {
  commodityPeriodsCases,
  commodityPeriodsDirectory,
  commodityPeriodsFunction
} from '../../../../test/helpers/cdm-commodity-periods.js';
import { installPublishedNativeImplementations } from '../../../../test/helpers/curated-implementations.js';
import { GENERATED_MODULE_TEST_TIMEOUT } from '../../../../test/helpers/vitest-budget.js';
import { generatePythonModule, generateSelected } from '../../src/export.js';
import { referenceFiles } from '../helpers/cdm-reference.js';
import { compileGeneratedTypeScript } from '../helpers/compiled-typescript.js';
import { runPython } from '../projection/python-test-utils.js';

let docs: LangiumDocument[];
beforeAll(async () => {
  const { RuneDsl } = createRuneDslServices();
  const workspace = RuneDsl.shared.workspace;
  await workspace.WorkspaceManager.initializeWorkspace([]);
  docs = referenceFiles(commodityPeriodsDirectory).map(({ uri, content }) =>
    workspace.LangiumDocumentFactory.fromString(content, URI.parse(uri))
  );
  for (const doc of docs) workspace.LangiumDocuments.addDocument(doc);
  await workspace.DocumentBuilder.build(docs, { eagerLinking: true });
  assertValidDocuments(docs);
  installPublishedNativeImplementations(docs);
});

it.each(['single-file', 'per-namespace', 'barrel'] as const)(
  'executes commodity calculation periods in strict %s TypeScript',
  async (layout) => {
    const { outputs } = await generateSelected(
      docs,
      { namespaces: [], declarations: [commodityPeriodsFunction] },
      { target: 'typescript', strict: true, typescript: { layout } }
    );
    expect(outputs.flatMap((file) => file.diagnostics)).toEqual([]);
    const output = outputs.find((file) => file.funcs.some((fn) => fn.name === commodityPeriodsFunction.name))!;
    const emitted = output.funcs.find((fn) => fn.name === commodityPeriodsFunction.name)!;
    const execute = compileGeneratedTypeScript(outputs, { entry: output.relativePath })[emitted.exportName!]!;
    for (const test of commodityPeriodsCases) {
      const { fpmlCommodityCalculationPeriodsSchedule, effectiveDate, terminationDate } = test.inputs;
      const run = () =>
        execute(
          fpmlCommodityCalculationPeriodsSchedule,
          effectiveDate === undefined ? undefined : Temporal.PlainDate.from(effectiveDate),
          terminationDate === undefined ? undefined : Temporal.PlainDate.from(terminationDate)
        );
      if (test.expectedError) expect(run, test.id).toThrow(test.expectedError);
      else expect(JSON.parse(JSON.stringify(run())), test.id).toEqual(test.expected);
    }
  },
  GENERATED_MODULE_TEST_TIMEOUT
);

it('executes the same commodity boundaries and errors in standalone Python', () => {
  const python = generatePythonModule(docs);
  expect(python.diagnostics).toEqual([]);
  const { namespace, name } = commodityPeriodsFunction;
  const execute = python.bindings.get(`${namespace}.${name}`)!;
  const results = runPython(
    commodityPeriodsCases.map((test) => ({ expression: `${execute}(data)`, data: test.inputs })),
    python.code,
    { includeRuntime: false }
  );
  expect(results).toEqual(
    commodityPeriodsCases.map((test) =>
      test.expectedError ? { error: expect.stringContaining(test.expectedError) } : { value: test.expected }
    )
  );
});
