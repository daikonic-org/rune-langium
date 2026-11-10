// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCuratedRuneProject, withCuratedFixtureOverride } from './curated-rune-project.js';

export const marketDirectory = resolve(import.meta.dirname, '../fixtures/third-party/cdm-market-observations');
const indexNamespace = 'cdm.observable.asset.calculatedrate';
export const marketDeclarations = [
  { namespace: indexNamespace, name: 'IndexValueObservation', kind: 'RosettaFunction' },
  { namespace: indexNamespace, name: 'IndexValueObservationMultiple', kind: 'RosettaFunction' },
  { namespace: 'cdm.event.instructioncomposition.reset', name: 'GetMarketRates', kind: 'RosettaFunction' }
] as const;

export interface MarketCase {
  id: string;
  function: (typeof marketDeclarations)[number]['name'];
  dates: string[];
  tenor?: number;
  index?: 'sofr' | 'inflation';
  expected?: number[];
  error?: string;
}

export const marketCases: MarketCase[] = JSON.parse(readFileSync(resolve(marketDirectory, 'cases.json'), 'utf8'));

export function marketIndex({ index, tenor = 3 }: MarketCase) {
  const value = index === 'sofr' ? 'USD_SOFR' : 'EUR_EURIBOR_Act_365';
  const base = {
    assetType: 'Other',
    assetClass: 'InterestRate',
    identifier: [{ identifier: { value: index === 'inflation' ? 'AUD_CPI' : value, meta: {} }, identifierType: 'Name' }]
  };
  return index === 'inflation'
    ? { inflationIndex: { ...base, inflationRateIndex: { value: 'AUD_CPI', meta: {} } } }
    : {
        floatingRateIndex: {
          ...base,
          floatingRateIndex: { value, meta: {} },
          indexTenor: { period: 'M', periodMultiplier: tenor }
        }
      };
}

export function marketExpected(test: MarketCase) {
  if (test.function === 'GetMarketRates')
    return test.dates.map((date, index) => ({ date, value: test.expected?.[index] }));
  return test.function === 'IndexValueObservation' ? test.expected?.[0] : test.expected;
}

export const marketCaller = {
  uri: 'file:///model/market.rosetta',
  content: `namespace example.market
import cdm.base.datetime.*
import cdm.base.math.DatedValue
import cdm.base.staticdata.asset.common.*
import cdm.base.staticdata.asset.rates.*
import cdm.observable.asset.*
import cdm.observable.asset.calculatedrate.IndexValueObservation

func FixtureMarketObservations:
    inputs:
        index InterestRateIndex (1..1)
        dates date (1..*)
    output:
        observations DatedValue (0..*)

    alias floating: index as FloatingRateIndex
    alias inflation: index as InflationIndex
    alias tenor: floating -> indexTenor
    set observations:
        if inflation -> inflationRateIndex = InflationRateIndexEnum -> AUD_CPI
        then [DatedValue { date: date {year: 2021, month: 7, day: 30}, value: 0 }]
        else if floating -> floatingRateIndex = FloatingRateIndexEnum -> EUR_EURIBOR_Act_365 and tenor -> period = PeriodEnum -> M
        then if tenor -> periodMultiplier = 3
            then [
                DatedValue { date: date {year: 2021, month: 7, day: 31}, value: 0.033 },
                DatedValue { date: date {year: 2021, month: 7, day: 30}, value: 0.0329 },
                DatedValue { date: date {year: 2021, month: 8, day: 1}, value: 0.01 },
                DatedValue { date: date {year: 2021, month: 1, day: 1}, value: 0.01 },
                DatedValue { date: date {year: 2021, month: 6, day: 1}, value: 0.02 },
                DatedValue { date: date {year: 2021, month: 7, day: 1}, value: 0.03 },
                DatedValue { date: date {year: 2021, month: 7, day: 3}, value: 0.0302 },
                DatedValue { date: date {year: 2021, month: 7, day: 3}, value: 0.04 }
            ]
            else if tenor -> periodMultiplier = 6
                then [DatedValue { date: date {year: 2021, month: 7, day: 30}, value: -00.007 }]
                else empty
        else empty

func ObserveFixtureDate:
    inputs: observationDate date (1..1)
    output: rate number (1..1)
    set rate: IndexValueObservation(observationDate, InterestRateIndex {
        FloatingRateIndex: FloatingRateIndex {
            assetType: AssetTypeEnum -> Other,
            assetClass: AssetClassEnum -> InterestRate,
            identifier: [AssetIdentifier { identifier: "EUR-EURIBOR-Act/365", identifierType: AssetIdTypeEnum -> Name }],
            floatingRateIndex: FloatingRateIndexEnum -> EUR_EURIBOR_Act_365,
            indexTenor: Period { period: PeriodEnum -> M, periodMultiplier: 3 }
        }
    })
`
};

const providerBinding = {
  kind: 'declaration',
  source: { model: 'local', namespace: 'impl.cdm.market', kind: 'RosettaFunction', name: 'ReadMarketObservations' },
  replacement: {
    model: 'local',
    namespace: 'example.market',
    kind: 'RosettaFunction',
    name: 'FixtureMarketObservations'
  }
} as const;

export async function createCuratedMarketProject(withProvider = true) {
  const project = await createCuratedRuneProject(marketDirectory, marketCaller);
  return withProvider ? withCuratedFixtureOverride(project, providerBinding) : project;
}
