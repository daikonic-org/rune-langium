// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { generatePythonModule, generateSelected } from '@rune-langium/codegen/export';
import { compileGeneratedTypeScript } from '../../codegen/test/helpers/compiled-typescript.js';
import { runPython } from '../../codegen/test/projection/python-test-utils.js';
import {
  collateralProduct,
  collateralSchedule,
  createCuratedCollateralPortfolioProject
} from '../../../test/helpers/cdm-collateral-portfolio.js';
import { GENERATED_MODULE_TEST_TIMEOUT } from '../../../test/helpers/vitest-budget.js';
import { buildEffectiveProject } from '../src/effective-project.js';

interface EligibilityCase {
  id: string;
  function: 'CheckEligibilityForProduct';
  identifier?: string;
  currencies: string[];
  include?: boolean;
  eligible?: boolean;
  expectedError?: string;
}

interface PortfolioCase {
  id: string;
  function: 'EvaluatePortfolioState';
  total: boolean;
  status?: string;
  filter?: string;
  expectedShares?: number;
  expectedError?: string;
}

type DomainCase = EligibilityCase | PortfolioCase;
const cases: DomainCase[] = JSON.parse(
  readFileSync(
    new URL('../../../test/fixtures/third-party/cdm-collateral-portfolio/cases.json', import.meta.url),
    'utf8'
  )
);
const declarations = {
  CheckEligibilityForProduct: {
    namespace: 'cdm.product.collateral',
    name: 'CheckEligibilityForProduct',
    kind: 'RosettaFunction'
  },
  EvaluatePortfolioState: { namespace: 'cdm.event.position', name: 'EvaluatePortfolioState', kind: 'RosettaFunction' }
} as const;
const selection = { namespaces: [], declarations: Object.values(declarations) };
let graph: Awaited<ReturnType<typeof buildEffectiveProject>>;

beforeAll(async () => {
  const project = await createCuratedCollateralPortfolioProject();
  graph = await buildEffectiveProject(project.installed, project.references);
  expect(graph.diagnostics).toEqual([]);
  expect(
    graph.documents.flatMap(({ uri, parseResult }) =>
      [...parseResult.lexerErrors, ...parseResult.parserErrors].map(({ message }) => uri.path + ': ' + message)
    )
  ).toEqual([]);
  expect([...project.changes.keys()]).toEqual(
    expect.arrayContaining([
      'model/implementations/cdm/check-eligibility-for-product.rosetta',
      'model/implementations/cdm/evaluate-portfolio-state.rosetta'
    ])
  );
}, GENERATED_MODULE_TEST_TIMEOUT);

function inputs(test: DomainCase, nativeDateTime: (text: string) => unknown = (text) => text) {
  if (test.function === 'EvaluatePortfolioState')
    return {
      portfolio: {
        aggregationParameters: {
          dateTime: nativeDateTime('2024-01-31T15:00:00Z[UTC]'),
          totalPosition: test.total,
          positionStatus: test.status ?? 'Executed',
          productQualifier: test.filter ? [test.filter] : []
        },
        portfolioState: { positions: [], lineage: {}, meta: { globalKey: 'opening-state' } }
      }
    };
  return {
    specifications: test.currencies.map((currency) => collateralSchedule(currency, test.include)),
    product: test.identifier ? collateralProduct(test.identifier) : undefined
  };
}

function expectResult(value: unknown, test: DomainCase) {
  if (test.function === 'EvaluatePortfolioState') {
    expect(value, test.id).toMatchObject({
      lineage: { portfolioStateReference: [{ globalReference: 'opening-state' }] },
      positions:
        test.expectedShares === undefined
          ? []
          : [
              {
                product: { nonTransferableProduct: { identifier: [{ identifier: { value: 'SAMPLE' } }] } },
                priceQuantity: [
                  { quantity: { value: { value: test.expectedShares, unit: { financialUnit: 'Share' } } } },
                  {
                    quantity: {
                      value: {
                        value: 7,
                        unit: { currency: { value: 'USD', meta: { scheme: 'urn:fixture:currency' } } }
                      }
                    }
                  }
                ]
              }
            ]
    });
    return;
  }
  if (test.eligible === undefined) {
    expect(value ?? undefined, test.id).toBeUndefined();
    return;
  }
  expect(value, test.id).toMatchObject({
    isEligible: test.eligible,
    eligibilityQuery: { maturity: 5, assetCountryOfOrigin: 'JP', denominatedCurrency: 'JPY' },
    matchingEligibleCriteria: test.eligible
      ? [expect.objectContaining({ treatment: { isIncluded: true, valuationTreatment: { haircutPercentage: 0.05 } } })]
      : []
  });
}

it(
  'checks collateral schedules and portfolio aggregation in strict generated TypeScript',
  async () => {
    const { outputs } = await generateSelected([...graph.documents], selection, {
      target: 'typescript',
      strict: true,
      typescript: { layout: 'barrel' }
    });
    expect(outputs.flatMap((output) => output.diagnostics.filter(({ severity }) => severity === 'error'))).toEqual([]);
    const execute = compileGeneratedTypeScript(outputs, { entry: 'index.ts', checkTypes: 'workspace' });
    for (const test of cases) {
      const run = () =>
        execute[test.function]!(...Object.values(inputs(test, (text) => Temporal.ZonedDateTime.from(text))));
      if (test.expectedError) expect(run, test.id).toThrow(test.expectedError);
      else {
        const result = run();
        expectResult(result == null ? result : JSON.parse(JSON.stringify(result)), test);
      }
    }
  },
  // The strict compile includes both linked model closures under root coverage.
  120_000
);

it(
  'checks the same collateral and portfolio cases in standalone Python',
  () => {
    const python = generatePythonModule(graph.documents);
    expect(python.diagnostics.filter(({ severity }) => severity === 'error')).toEqual([]);
    const calls = cases.map((test) => {
      const declaration = declarations[test.function];
      return {
        expression: python.bindings.get(declaration.namespace + '.' + declaration.name) + '(data)',
        data: inputs(test)
      };
    });
    const results = runPython(calls, python.code, { includeRuntime: false });
    expect(results).toHaveLength(cases.length);
    for (const [index, test] of cases.entries()) {
      const result = results[index]!;
      if (test.expectedError) expect(result, test.id).toEqual({ error: expect.stringContaining(test.expectedError) });
      else {
        expect(result, test.id).toHaveProperty('value');
        expectResult('value' in result ? result.value : undefined, test);
      }
    }
  },
  GENERATED_MODULE_TEST_TIMEOUT
);

it(
  'reports required project providers in both executable targets',
  async () => {
    const project = await createCuratedCollateralPortfolioProject(false);
    const unbound = await buildEffectiveProject(project.installed, project.references);
    const { outputs } = await generateSelected([...unbound.documents], selection, { target: 'typescript' });
    const python = generatePythonModule(unbound.documents);
    for (const diagnostics of [outputs.flatMap((output) => output.diagnostics), python.diagnostics]) {
      for (const provider of [
        'impl.cdm.collateral.ReadProductEligibilityInputs',
        'impl.cdm.portfolio.ReadPortfolioAggregationInputs'
      ]) {
        expect(diagnostics).toContainEqual(
          expect.objectContaining({
            code: 'native-implementation-unavailable',
            message: expect.stringContaining(provider)
          })
        );
      }
    }
  },
  GENERATED_MODULE_TEST_TIMEOUT
);
