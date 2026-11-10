// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, expect, it } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { getElementNamespace, isRosettaFunction, isRosettaModel } from '@rune-langium/core';
import { generatePythonModule, generateSelected } from '@rune-langium/codegen/export';
import { createProjectDraftSnapshot } from '@rune-langium/project-config';
import { compileGeneratedTypeScript } from '../../codegen/test/helpers/compiled-typescript.js';
import { runPython } from '../../codegen/test/projection/python-test-utils.js';
import { calculationPeriodCalendars } from '../../../test/helpers/cdm-calculation-period.js';
import { createCuratedRuneProject, withCuratedFixtureOverride } from '../../../test/helpers/curated-rune-project.js';
import { GENERATED_MODULE_TEST_TIMEOUT } from '../../../test/helpers/vitest-budget.js';
import { buildEffectiveProject } from '../src/effective-project.js';

const fixture = new URL('../../../test/fixtures/third-party/cdm-floating-rate-reset/', import.meta.url);
const declaration = {
  name: 'ProcessFloatingRateReset',
  namespace: 'cdm.product.asset.floatingrate',
  kind: 'RosettaFunction'
};
const identity = declaration.namespace + '.' + declaration.name;
const market = {
  uri: 'file:///model/reset-observations.rosetta',
  content: `namespace example.reset
import cdm.base.math.DatedValue
import cdm.base.staticdata.asset.rates.FloatingRateIndexEnum
import cdm.observable.asset.InterestRateIndex
import cdm.observable.asset.FloatingRateIndex

func FixtureObservations:
    inputs:
        index InterestRateIndex (1..1)
        dates date (1..*)
    output:
        observations DatedValue (0..*)
    alias floating: index as FloatingRateIndex
    alias name: floating -> floatingRateIndex
    set observations:
        if name = FloatingRateIndexEnum -> USD_SOFR_Compounded_Index
        then dates extract [DatedValue { date: item, value: 100 + (item -> day - 3) / 10 }]
        else if name = FloatingRateIndexEnum -> USD_SOFR
        then dates extract [DatedValue { date: item, value: (item -> day) / 100 }]
`
};

interface ResetCase {
  id: string;
  selector: string;
  fixingOffset?: number;
  resetRelativeTo?: string;
  expectedRate?: number;
  expectedGrowth?: number;
  missingIndex?: boolean;
  resetDate?: string;
  observationDate?: string;
  expectedError?: string;
}
const cases: ResetCase[] = JSON.parse(readFileSync(new URL('cases.json', fixture), 'utf8'));
let selected: Awaited<ReturnType<typeof generateSelected>>;

beforeAll(async () => {
  const project = await withCuratedFixtureOverride(await createCuratedRuneProject(fileURLToPath(fixture), market), {
    kind: 'declaration',
    source: { model: 'local', namespace: 'impl.cdm.market', kind: 'RosettaFunction', name: 'ReadMarketObservations' },
    replacement: { model: 'local', namespace: 'example.reset', kind: 'RosettaFunction', name: 'FixtureObservations' }
  });
  const calendarPath = 'model/implementations/cdm/business-center-holidays.rosetta';
  expect(project.installed.files.has(calendarPath)).toBe(true);
  expect(project.installed.files.has('model/implementations/cdm/process-compound-index-reset.rosetta')).toBe(true);
  const snapshot = await createProjectDraftSnapshot(
    project.installed,
    new Map([[calendarPath, calculationPeriodCalendars.content]]),
    () => []
  );
  const graph = await buildEffectiveProject(snapshot, project.references);
  expect(graph.diagnostics).toEqual([]);
  const selectors = graph.documents
    .map((doc) => doc.parseResult.value)
    .filter(isRosettaModel)
    .flatMap((model) => model.elements)
    .filter(isRosettaFunction)
    .filter((func) => func.name === declaration.name && getElementNamespace(func) === declaration.namespace)
    .filter((func) => func.dispatchValue && func.operations.length > 0)
    .map((func) => func.dispatchValue!.value.$refText);
  expect(new Set(selectors)).toEqual(new Set(cases.filter((test) => !test.expectedError).map((test) => test.selector)));
  selected = await generateSelected(
    [...graph.documents],
    { namespaces: [], declarations: [declaration] },
    { target: 'typescript', strict: true, typescript: { layout: 'barrel' } }
  );
  expect(
    selected.outputs.flatMap((output) => output.diagnostics.filter(({ severity }) => severity === 'error'))
  ).toEqual([]);
}, GENERATED_MODULE_TEST_TIMEOUT);

function inputs(test: ResetCase, date: (value: string) => unknown = (value) => value) {
  const centers = { businessCenter: [{ value: 'GBLO' }] };
  const index =
    test.selector !== 'CompoundIndex'
      ? 'USD_SOFR'
      : test.missingIndex
        ? 'USD_SOFR_ICE_Compounded_Index'
        : 'USD_SOFR_Compounded_Index';
  return {
    payout: {
      payerReceiver: { payer: 'Party1', receiver: 'Party2' },
      dayCountFraction: { value: 'ACT_360' },
      rateSpecification: {
        floatingRateSpecification: {
          rateOption: {
            value: {
              floatingRateIndex: {
                assetType: 'Other',
                assetClass: 'InterestRate',
                identifier: [{ identifier: { value: index }, identifierType: 'Name' }],
                floatingRateIndex: { value: index }
              }
            }
          },
          calculationParameters: { calculationMethod: 'Averaging', applicableBusinessDays: centers }
        }
      },
      resetDates: {
        resetRelativeTo: test.resetRelativeTo ?? 'CalculationPeriodStartDate',
        fixingDates: {
          periodMultiplier: test.fixingOffset ?? 0,
          period: 'D',
          businessDayConvention: 'NONE',
          businessCenters: centers
        }
      },
      calculationPeriodDates: {
        effectiveDate: { adjustableDate: { unadjustedDate: date('2024-04-03') } },
        terminationDate: { adjustableDate: { unadjustedDate: date('2024-08-03') } },
        calculationPeriodDatesAdjustments: { businessDayConvention: 'NONE' },
        calculationPeriodFrequency: { period: 'M', periodMultiplier: 1, rollConvention: '_3' }
      }
    },
    period: { adjustedStartDate: date('2024-06-03'), adjustedEndDate: date('2024-06-06') },
    selector: test.selector
  };
}

function expectResult(value: unknown, test: ResetCase) {
  expect(value, test.id).toMatchObject({ floatingRate: expect.closeTo(test.expectedRate!, 12) });
  if (test.resetDate) {
    expect(value, test.id).toMatchObject({ resetDate: test.resetDate, observationDate: test.observationDate });
    return;
  }
  if (test.selector === 'CompoundIndex') {
    expect(value, test.id).toMatchObject({
      calculationDetails: {
        calculatedRate: expect.closeTo(test.expectedRate!, 12),
        observations: { observationDates: ['2024-06-03', '2024-06-06'], observedRates: [100, 100.3] }
      }
    });
    return;
  }
  expect(value, test.id).toMatchObject({
    calculationDetails: {
      aggregateWeight: 3,
      calculatedRate: expect.closeTo(test.expectedRate!, 12),
      observations: {
        observationDates: ['2024-06-03', '2024-06-04', '2024-06-05'],
        weights: [1, 1, 1],
        observedRates: [0.03, 0.04, 0.05]
      },
      ...(test.expectedGrowth === undefined ? {} : { aggregateValue: expect.closeTo(test.expectedGrowth, 12) })
    }
  });
}

it(
  'runs all authored rate-reset selectors and stops inactive recursion in strict TypeScript',
  () => {
    const execute = compileGeneratedTypeScript(selected.outputs, { entry: 'index.ts', checkTypes: 'workspace' });
    const date = (value: string) => Temporal.PlainDate.from(value);
    for (const test of cases) {
      const { payout, period, selector } = inputs(test, date);
      const run = () => execute.ProcessFloatingRateReset!(payout, period, selector);
      if (test.expectedError) expect(run, test.id).toThrow(new RegExp(test.expectedError));
      else expectResult(JSON.parse(JSON.stringify(run())), test);
    }
    expect(execute.GenerateDateList!(date('2024-06-04'), date('2024-06-03'), ['UNKNOWN'])).toEqual([]);
  },
  GENERATED_MODULE_TEST_TIMEOUT
);

it(
  'runs the same source dispatch and base case in standalone Python',
  () => {
    const module = generatePythonModule(selected.selection.documents);
    const reset = module.bindings.get(identity);
    const dates = module.bindings.get('cdm.base.datetime.GenerateDateList');
    const results = runPython(
      [
        ...cases.map((test) => ({
          expression: `${reset}(data['payout'], data['period'], data['selector'])`,
          data: inputs(test)
        })),
        { expression: `${dates}('2024-06-04', '2024-06-03', ['UNKNOWN'])` }
      ],
      module.code,
      { includeRuntime: false }
    );
    for (const [index, test] of cases.entries()) {
      const result = results[index]!;
      if (test.expectedError) expect(result, test.id).toEqual({ error: expect.stringMatching(test.expectedError) });
      else expectResult('value' in result ? result.value : undefined, test);
    }
    expect(results.at(-1)).toEqual({ value: [] });
  },
  GENERATED_MODULE_TEST_TIMEOUT
);
