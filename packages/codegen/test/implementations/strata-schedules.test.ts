// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { beforeAll, expect, it } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { buildEffectiveProject } from '../../../project-runtime/src/effective-project.js';
import {
  createCuratedScheduleProject,
  scheduleCases,
  scheduleDeclarations
} from '../../../../test/helpers/cdm-strata-schedules.js';
import { GENERATED_MODULE_TEST_TIMEOUT } from '../../../../test/helpers/vitest-budget.js';
import { generatePythonModule, generateSelected } from '../../src/export.js';
import { compileGeneratedTypeScript } from '../helpers/compiled-typescript.js';
import { runPython } from '../projection/python-test-utils.js';

let graph: Awaited<ReturnType<typeof buildEffectiveProject>>;
beforeAll(async () => {
  const project = await createCuratedScheduleProject();
  expect(project.installed.files.get('model/implementations/cdm/calculation-schedules.rosetta')).toContain(
    'override namespace cdm.product.common.schedule'
  );
  graph = await buildEffectiveProject(project.installed, project.references);
  expect(graph.diagnostics).toEqual([]);
});

it.each(['single-file', 'per-namespace', 'barrel'] as const)(
  'matches the CDM schedule oracle in strict %s TypeScript',
  async (layout) => {
    const { outputs } = await generateSelected(
      [...graph.documents],
      { namespaces: [], declarations: scheduleDeclarations },
      { target: 'typescript', strict: true, typescript: { layout } }
    );
    expect(outputs.flatMap((output) => output.diagnostics)).toEqual([]);
    const entry = outputs.find((output) => output.funcs.some((fn) => fn.name === 'CalculationPeriod'))!;
    const functions = compileGeneratedTypeScript(outputs, { entry: entry.relativePath });
    for (const test of scheduleCases) {
      const name = entry.funcs.find((fn) => fn.name === test.function)!.exportName!;
      const input = JSON.parse(JSON.stringify(test.inputs.calculationPeriodDates), (_key, value: unknown) =>
        typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? Temporal.PlainDate.from(value) : value
      );
      const target = test.inputs.date == null ? undefined : Temporal.PlainDate.from(test.inputs.date);
      const run = () =>
        test.function === 'CalculationPeriod' ? functions[name]!(input, target) : functions[name]!(input);
      if (test.expectedError) expect(run, test.id).toThrow(test.expectedError);
      else expect(JSON.parse(JSON.stringify(run())), test.id).toEqual(test.expected);
    }
  },
  GENERATED_MODULE_TEST_TIMEOUT
);

it('matches the same CDM schedule oracle in standalone Python', () => {
  const python = generatePythonModule(graph.documents);
  expect(python.diagnostics).toEqual([]);
  const results = runPython(
    scheduleCases.map((test) => ({
      expression: `${python.bindings.get('cdm.product.common.schedule.' + test.function)}(data)`,
      data: test.inputs
    })),
    python.code,
    { includeRuntime: false }
  );
  for (const [index, test] of scheduleCases.entries()) {
    const error = test.expectedPythonError ?? test.expectedError;
    expect(results[index], test.id).toEqual(
      error ? { error: expect.stringContaining(error) } : { value: test.expected }
    );
  }
});
