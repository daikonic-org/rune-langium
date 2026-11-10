// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { createHash } from 'node:crypto';
import { beforeAll, expect, it } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { generatePythonModule, generateSelected } from '@rune-langium/codegen/export';
import { compileGeneratedTypeScript } from '../../codegen/test/helpers/compiled-typescript.js';
import { runPython } from '../../codegen/test/projection/python-test-utils.js';
import {
  calendarCases,
  calendarDeclarations,
  createCuratedCalendarProject
} from '../../../test/helpers/cdm-business-calendars.js';
import { GENERATED_MODULE_TEST_TIMEOUT } from '../../../test/helpers/vitest-budget.js';
import { buildEffectiveProject } from '../src/effective-project.js';

let graph: Awaited<ReturnType<typeof buildEffectiveProject>>;

beforeAll(async () => {
  const project = await createCuratedCalendarProject();
  expect(project.installed.files.get('model/implementations/cdm/strata-holiday-data.rosetta')).toContain('2.12.78');
  graph = await buildEffectiveProject(project.installed, project.references);
  expect(graph.diagnostics).toEqual([]);
}, GENERATED_MODULE_TEST_TIMEOUT);

function expectDates(test: (typeof calendarCases)[number], result: unknown) {
  if (test.holidayDigest === undefined) {
    expect(result, test.id).toEqual(test.expected);
    return;
  }
  if (!Array.isArray(result)) throw new Error('Expected a holiday list: ' + test.id);
  expect(result, test.id).toHaveLength(test.holidayCount!);
  expect(createHash('sha256').update(result.join('\n')).digest('hex'), test.id).toBe(test.holidayDigest);
}

it.each(['single-file', 'per-namespace', 'barrel'] as const)(
  'checks the calendar snapshot and date-aware guards in strict %s TypeScript',
  async (layout) => {
    const { outputs } = await generateSelected(
      [...graph.documents],
      { namespaces: [], declarations: calendarDeclarations },
      { target: 'typescript', strict: true, typescript: { layout } }
    );
    expect(outputs.flatMap((output) => output.diagnostics)).toEqual([]);
    for (const declaration of calendarDeclarations) {
      const entry = outputs.find((output) => output.funcs.some((fn) => fn.name === declaration.name))!;
      const name = entry.funcs.find((fn) => fn.name === declaration.name)!.exportName!;
      const execute = compileGeneratedTypeScript(outputs, { entry: entry.relativePath })[name]!;
      for (const test of calendarCases.filter((item) => item.function === declaration.name)) {
        const run = () => {
          if (test.function === 'BusinessCenterHolidays') return execute(test.inputs.businessCenter);
          const { period, dates, businessCenters } = test.inputs;
          const interval =
            period &&
            Object.fromEntries(Object.entries(period).map(([key, value]) => [key, Temporal.PlainDate.from(value)]));
          return execute(
            businessCenters,
            interval,
            (dates ?? []).map((date) => Temporal.PlainDate.from(date))
          );
        };
        if (test.expectedError) expect(run, test.id).toThrow(test.expectedError);
        else expectDates(test, JSON.parse(JSON.stringify(run())));
      }
    }
  },
  GENERATED_MODULE_TEST_TIMEOUT
);

it(
  'checks the same calendar snapshot and guards in standalone Python',
  () => {
    const python = generatePythonModule(graph.documents);
    expect(python.diagnostics).toEqual([]);
    const byName = new Map(calendarDeclarations.map(({ namespace, name }) => [name, namespace + '.' + name]));
    const results = runPython(
      calendarCases.map((test) => ({
        expression: `${python.bindings.get(byName.get(test.function)!)}(data)`,
        data: test.inputs
      })),
      python.code,
      { includeRuntime: false }
    );
    expect(results).toHaveLength(calendarCases.length);
    for (const [index, test] of calendarCases.entries()) {
      const result = results[index];
      if (test.expectedError) expect(result, test.id).toEqual({ error: expect.stringContaining(test.expectedError) });
      else if (result && typeof result === 'object' && 'value' in result) expectDates(test, result.value);
      else throw new Error('Unexpected Python result for ' + test.id + ': ' + JSON.stringify(result));
    }
  },
  GENERATED_MODULE_TEST_TIMEOUT
);
