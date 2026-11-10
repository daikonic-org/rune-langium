// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prepareCdmCodeLists } from '../../packages/project-runtime/src/curated-implementations/code-list-resources.js';
import {
  createCuratedRuneProject,
  curatedFixtureResources,
  withCuratedFixtureOverride
} from './curated-rune-project.js';

const fixtures = resolve(import.meta.dirname, '../fixtures/third-party');
const directory = resolve(fixtures, 'cdm-observation-resolution');

export const observationResolutionDeclarations = [
  { namespace: 'cdm.observable.event', name: 'ResolveObservation', kind: 'RosettaFunction' },
  { namespace: 'cdm.product.asset', name: 'ResolveRateIndex', kind: 'RosettaFunction' },
  { namespace: 'example.observation', name: 'ResolveFixtureObservations', kind: 'RosettaFunction' },
  { namespace: 'example.observation', name: 'PublishedIndexRate', kind: 'RosettaFunction' }
] as const;

export interface ObservationResolutionCase {
  id: string;
  function: 'ResolveObservation' | 'ResolveRateIndex';
  days?: number[];
  page?: string;
  scheme?: string;
  calculation?: 'Arithmetic' | 'Geometric' | 'Harmonic';
  weighted?: boolean;
  index?: string;
  value?: number;
  error?: string;
}

export const observationResolutionCases: ObservationResolutionCase[] = JSON.parse(
  readFileSync(resolve(directory, 'cases.json'), 'utf8')
);

const readings: [
  day: number,
  value: number,
  weight: number | undefined,
  page?: string,
  scheme?: string,
  currency?: string
][] = [
  [1, 37, 1],
  [2, 37.2, 2],
  [3, 37.4, 3],
  [4, 37.6, 4],
  [5, 37.8, 5],
  [1, 38.5, 1, 'Main', 'urn:fixture:alternate'],
  [1, 39, 1, 'Intraday'],
  [6, 4, 1],
  [7, 16, 3],
  [8, 0, 1],
  [9, -4, 1],
  [10, 36, undefined],
  [11, -16, 0],
  [12, 5, 1],
  [12, 6, 1],
  [13, 7, 1],
  [14, 8, -1],
  [15, 9, 1, 'Main', undefined, 'EUR']
];

const fixtureReadings = readings
  .map(
    ([day, value, weight, page = 'Main', scheme, currency = 'USD']) =>
      `FixtureReading(${day}, ${JSON.stringify(page)}, ${scheme ? JSON.stringify(scheme) : 'empty'}, ${value}, ${weight ?? 'empty'}, ${JSON.stringify(currency)})`
  )
  .join(',\n        ');

// Curated codes and legacy CDM member identifiers are distinct representations.
const snapshotIndices: [code: string, member: string, quotes: number[]][] = [
  ['EUR-EURIBOR', 'EUR_EURIBOR', [0.0875]],
  ['USD-SOFR', 'USD_SOFR', [-0.01]],
  ['GBP-SONIA', 'GBP_SONIA', [0]],
  ['USD-LIBOR', 'USD_LIBOR', [0.02, 0.021]],
  ['EUR-EuroSTR', 'EUR_EuroSTR', []]
];
const snapshotQuotes = snapshotIndices
  .flatMap(([, member, quotes]) =>
    quotes.map((rate) => `RateIndexQuote { index: FloatingRateIndexEnum -> ${member}, rate: ${rate} }`)
  )
  .join(',\n        ');
const fixtureIndexLookup = snapshotIndices
  .map(([code, member]) => `if wireCode = ${JSON.stringify(code)} then FloatingRateIndexEnum -> ${member}`)
  .join('\n        else ');

export const observationResolutionCaller = {
  uri: 'file:///model/observation-resolution.rosetta',
  content: `namespace example.observation
import cdm.base.math.*
import cdm.base.staticdata.asset.common.*
import cdm.base.staticdata.asset.rates.FloatingRateIndexEnum
import cdm.observable.asset.InformationProviderEnum
import cdm.observable.asset.InformationSource
import cdm.observable.asset.Observable
import cdm.observable.asset.Price
import cdm.observable.asset.PriceTypeEnum
import cdm.observable.event.*
import cdm.product.asset.ResolveRateIndex
import impl.cdm.market.*
import rune.resources.cdm.FloatingRateIndex

func FixtureIdentifier:
    inputs:
        day int (1..1)
        page string (1..1)
        scheme string (0..1)
    output: identifier ObservationIdentifier (1..1)
    set identifier: ObservationIdentifier {
        observable: Observable { Asset: Asset { Cash: Cash {
            identifier: [AssetIdentifier { identifier: "USD", identifierType: AssetIdTypeEnum -> CurrencyCode }],
            assetType: AssetTypeEnum -> Cash
        } } },
        observationDate: date { year: 2024, month: 10, day: day },
        informationSource: InformationSource {
            sourceProvider: InformationProviderEnum -> Reuters,
            sourcePage: page with-meta { scheme: scheme }
        }
    }

func FixtureReading:
    inputs:
        day int (1..1)
        page string (1..1)
        scheme string (0..1)
        amount number (1..1)
        weight number (0..1)
        currency string (1..1)
    output: reading ObservationReading (1..1)
    set reading: ObservationReading {
        observation: Observation {
            observationIdentifier: FixtureIdentifier(day, page, scheme),
            observedValue: Price {
                value: amount,
                unit: UnitType { currency: currency to-enum CurrencyCodeEnum },
                perUnitOf: UnitType { financialUnit: FinancialUnitEnum -> Share },
                priceType: PriceTypeEnum -> AssetPrice
            }
        },
        weight: weight
    }

func FixtureObservationInputs:
    inputs:
        identifiers ObservationIdentifier (1..*)
        averagingMethod AveragingCalculationMethod (0..1)
    output: dataset ObservationInputs (1..1)
    set dataset: ObservationInputs {
        readings: [
        ${fixtureReadings}
        ],
        aggregateIdentifier: if identifiers -> observationDate -> day all <> 13
            then FixtureIdentifier(28, "Aggregate", "urn:fixture:aggregate")
    }

func FixtureRateIndexSnapshot:
    inputs: index FloatingRateIndexEnum (1..1)
    output: quotes RateIndexQuote (0..*)
    set quotes: [
        ${snapshotQuotes}
    ]

func ResolveFixtureObservations:
    inputs:
        days int (1..*)
        page string (1..1)
        scheme string (0..1)
        averagingMethod AveragingCalculationMethod (0..1)
    output: result Observation (1..1)
    set result: ResolveObservation(days extract [FixtureIdentifier(item, page, scheme)], averagingMethod)

func PublishedObservation:
    inputs: day int (1..1)
    output: result Observation (1..1)
    set result: ResolveObservation([FixtureIdentifier(day, "Main", empty)], empty)

func PublishedIndexRate:
    inputs: code FloatingRateIndex (1..1)
    output: rate number (1..1)
    alias wireCode: code to-string
    alias index:
        ${fixtureIndexLookup}
    condition FixtureIndexAvailable:
        index exists
    set rate: ResolveRateIndex(index)
`
};

export async function createCuratedObservationResolutionProject(withProviders = true) {
  const resources = curatedFixtureResources(resolve(fixtures, 'cdm-floating-rate-metadata'));
  const project = await createCuratedRuneProject(
    directory,
    observationResolutionCaller,
    prepareCdmCodeLists([...resources.values()])
  );
  if (!withProviders) return project;
  return withCuratedFixtureOverride(
    project,
    {
      kind: 'declaration',
      source: { model: 'local', namespace: 'impl.cdm.market', kind: 'RosettaFunction', name: 'ReadObservationInputs' },
      replacement: {
        model: 'local',
        namespace: 'example.observation',
        kind: 'RosettaFunction',
        name: 'FixtureObservationInputs'
      }
    },
    {
      kind: 'declaration',
      source: { model: 'local', namespace: 'impl.cdm.market', kind: 'RosettaFunction', name: 'ReadRateIndexSnapshot' },
      replacement: {
        model: 'local',
        namespace: 'example.observation',
        kind: 'RosettaFunction',
        name: 'FixtureRateIndexSnapshot'
      }
    }
  );
}
