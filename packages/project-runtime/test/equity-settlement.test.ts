// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { beforeAll, expect, it } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { generatePythonModule, generateSelected } from '@rune-langium/codegen/export';
import { compileGeneratedTypeScript } from '../../codegen/test/helpers/compiled-typescript.js';
import { runPython } from '../../codegen/test/projection/python-test-utils.js';
import {
  createCuratedEquitySettlementProject,
  equitySettlementCases,
  equitySettlementInput,
  equitySettlementTradeState,
  type EquitySettlementCase
} from '../../../test/helpers/cdm-equity-settlement.js';
import { GENERATED_MODULE_TEST_TIMEOUT } from '../../../test/helpers/vitest-budget.js';
import { buildEffectiveProject } from '../src/effective-project.js';

const floating = {
  namespace: 'example.equitysettlement',
  name: 'PublishedFloatingPayout',
  kind: 'RosettaFunction'
} as const;
const cashDate = { namespace: 'cdm.event.common', name: 'ResolveCashSettlementDate', kind: 'RosettaFunction' } as const;
const equitySwap = { ...floating, name: 'PublishedEquitySwapFundingPayout' };
const cashAmount = { ...cashDate, name: 'EquityCashSettlementAmount' };
const selection = { namespaces: [], declarations: [floating, cashDate, equitySwap, cashAmount] };
const settlementPeriod = '2024-03-29';
let graph: Awaited<ReturnType<typeof buildEffectiveProject>>;

beforeAll(async () => {
  const project = await createCuratedEquitySettlementProject();
  graph = await buildEffectiveProject(project.installed, project.references);
  expect(graph.diagnostics).toEqual([]);
  expect(
    graph.documents.flatMap(({ uri, parseResult }) =>
      [...parseResult.lexerErrors, ...parseResult.parserErrors].map(({ message }) => uri.path + ': ' + message)
    )
  ).toEqual([]);
  expect([...project.changes.keys()]).toEqual(
    expect.arrayContaining(
      ['new-floating-payout', 'resolve-cash-settlement-date', 'equity-settlement-inputs'].map(
        (name) => 'model/implementations/cdm/' + name + '.rosetta'
      )
    )
  );
}, GENERATED_MODULE_TEST_TIMEOUT);

function expectPayment(value: unknown, test: EquitySettlementCase) {
  if (test.function === 'ResolveCashSettlementDate') {
    expect(value, test.id).toBe(test.expectedPayment);
    return;
  }
  expect(value, test.id).toMatchObject({
    payerReceiver: { payer: 'Party2', receiver: 'Party1' },
    priceQuantity: { resolvedQuantity: { value: 1000, unit: { currency: { value: 'USD' } } } },
    dayCountFraction: { meta: { scheme: 'urn:fixture:day-count' } },
    paymentDelay: false,
    ...(test.periodic
      ? { paymentDates: { firstPaymentDate: test.expectedPayment } }
      : { paymentDate: { adjustedDate: { value: test.expectedPayment } } })
  });
  const unusedPayment = test.periodic ? 'paymentDate' : 'paymentDates';
  expect(value, test.id).toSatisfy((payout: Record<string, unknown>) => payout[unusedPayment] == null);
  expect(JSON.stringify(value), test.id).toContain('USD_SOFR');
}

function expectCashAmount(value: unknown) {
  expect(value).toMatchObject({
    scheduledTransfer: {
      quantity: { value: expect.closeTo(110, 9) },
      settlementDate: { adjustedDate: { value: '2024-04-03' } }
    }
  });
}

it('constructs the funding leg and selects a cash settlement date in strict TypeScript', async () => {
  const { outputs } = await generateSelected([...graph.documents], selection, {
    target: 'typescript',
    strict: true,
    typescript: { layout: 'barrel' }
  });
  expect(outputs.flatMap((output) => output.diagnostics.filter(({ severity }) => severity === 'error'))).toEqual([]);
  const execute = compileGeneratedTypeScript(outputs, { entry: 'index.ts', checkTypes: 'workspace' });
  const nativeDate = (value: string) => Temporal.PlainDate.from(value);
  for (const test of equitySettlementCases) {
    const name = test.function === 'NewFloatingPayout' ? floating.name : cashDate.name;
    const run = () => execute[name]!(...Object.values(equitySettlementInput(test, nativeDate)));
    if ('error' in test && test.error) expect(run, test.id).toThrow(test.error);
    else expectPayment(JSON.parse(JSON.stringify(run())), test);
  }
  expectPayment(
    JSON.parse(JSON.stringify(execute[equitySwap.name]!(nativeDate('2024-06-03')))),
    equitySettlementCases[0]!
  );
  expectCashAmount(
    JSON.parse(
      JSON.stringify(
        execute[cashAmount.name]!(
          equitySettlementTradeState(settlementPeriod, nativeDate),
          nativeDate(settlementPeriod)
        )
      )
    )
  );
}, 60_000);

it(
  'uses the same inputs and agreement precedence in standalone Python',
  () => {
    const python = generatePythonModule(graph.documents);
    expect(python.diagnostics.filter(({ severity }) => severity === 'error')).toEqual([]);
    const cases = equitySettlementCases.map((test) => {
      const { namespace, name } = test.function === 'NewFloatingPayout' ? floating : cashDate;
      return { expression: python.bindings.get(namespace + '.' + name) + '(data)', data: equitySettlementInput(test) };
    });
    const results = runPython(
      [
        ...cases,
        {
          expression: python.bindings.get(equitySwap.namespace + '.' + equitySwap.name) + '(data)',
          data: { confirmationFirstPayment: '2024-06-03' }
        },
        {
          expression: python.bindings.get(cashAmount.namespace + '.' + cashAmount.name) + '(data)',
          data: { tradeState: equitySettlementTradeState(settlementPeriod), date: settlementPeriod }
        }
      ],
      python.code,
      { includeRuntime: false }
    );
    expect(results).toHaveLength(cases.length + 2);
    for (const [index, test] of equitySettlementCases.entries()) {
      const result = results[index]!;
      if ('error' in test && test.error)
        expect(result, test.id).toEqual({ error: expect.stringContaining(test.error) });
      else expectPayment('value' in result ? result.value : undefined, test);
    }
    const [funding, transfer] = results.slice(-2);
    expectPayment(funding && 'value' in funding ? funding.value : undefined, equitySettlementCases[0]!);
    expect(transfer).toHaveProperty('value');
    expectCashAmount(transfer && 'value' in transfer ? transfer.value : undefined);
  },
  GENERATED_MODULE_TEST_TIMEOUT
);

it(
  'reports unavailable contract data in both generated targets',
  async () => {
    const project = await createCuratedEquitySettlementProject(false);
    const unbound = await buildEffectiveProject(project.installed, project.references);
    const { outputs } = await generateSelected([...unbound.documents], selection, { target: 'typescript' });
    const python = generatePythonModule(unbound.documents);
    for (const diagnostics of [outputs.flatMap((output) => output.diagnostics), python.diagnostics]) {
      for (const name of ['ReadEquityFloatingTerms', 'ReadCashSettlementSchedule']) {
        expect(diagnostics).toContainEqual(
          expect.objectContaining({
            code: 'native-implementation-unavailable',
            message: expect.stringContaining('impl.cdm.settlement.' + name)
          })
        );
      }
    }
  },
  GENERATED_MODULE_TEST_TIMEOUT
);
