// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCuratedRuneProject, withCuratedFixtureOverride } from './curated-rune-project.js';

const directory = resolve(import.meta.dirname, '../fixtures/third-party/cdm-reset-forward-rates');
const curves: Record<string, [date: string, value: number][]> = JSON.parse(
  readFileSync(resolve(directory, 'curves.json'), 'utf8')
);

export type ResetForwardCase = { id: string; date: string; value?: number; error?: string } & (
  | { function: 'ResolveReset'; history: [string, string | null, number][]; recordDate?: string }
  | { function: 'InterpolateForwardRate'; curve: string; markToMarket?: number }
);
export const resetForwardCases: ResetForwardCase[] = JSON.parse(readFileSync(resolve(directory, 'cases.json'), 'utf8'));

const curveBranches = Object.entries(curves).map(([curve, points]) => {
  const quotes = points.map(([date, value]) => {
    const [year, month, day] = date.split('-').map(Number);
    return `DatedValue { date: date { year: ${year}, month: ${month}, day: ${day} }, value: ${value} }`;
  });
  return `if payout -> deliveryTerm = ${JSON.stringify(curve)} then [${quotes.join(', ')}]`;
});
const cashAsset = {
  Cash: { assetType: 'Cash', identifier: [{ identifier: { value: 'USD' }, identifierType: 'CurrencyCode' }] }
};

export const resetForwardCaller = {
  uri: 'file:///model/reset-forward-rates.rosetta',
  content: `namespace example.resetforward
import cdm.base.math.DatedValue
import cdm.base.staticdata.asset.common.*
import cdm.base.staticdata.party.*
import cdm.event.position.InterpolateForwardRate
import cdm.observable.asset.Observable
import cdm.product.common.settlement.*
import cdm.product.template.*
import impl.cdm.market.ForwardRateSnapshot

func FixtureForwardRateSnapshot:
    inputs: payout SettlementPayout (1..1)
    output: snapshot ForwardRateSnapshot (1..1)
    alias maturity: payout -> settlementTerms -> settlementDate -> valueDate
    alias quotes:
        ${curveBranches.join('\n        else ')}
    condition FixtureMaturity:
        maturity exists
    condition FixtureCurve:
        quotes exists
    set snapshot: ForwardRateSnapshot { maturity: maturity, quotes: quotes }

func PublishedForwardRate:
    inputs:
        maturity date (1..1)
        curve string (1..1)
    output: result number (1..1)
    alias payout: SettlementPayout {
        payerReceiver: PayerReceiver { payer: Party1, receiver: Party2 },
        underlier: Underlier {
            Observable: Observable {
                Asset: Asset {
                    Cash: Cash {
                        assetType: AssetTypeEnum -> Cash,
                        identifier: [AssetIdentifier {
                            identifier: "USD",
                            identifierType: AssetIdTypeEnum -> CurrencyCode
                        }]
                    }
                }
            }
        },
        settlementTerms: SettlementTerms {
            settlementType: SettlementTypeEnum -> Cash,
            settlementDate: SettlementDate { valueDate: maturity }
        },
        deliveryTerm: curve
    }
    set result: InterpolateForwardRate(payout)
`
};

export async function createCuratedResetForwardProject(withProvider = true) {
  const project = await createCuratedRuneProject(directory, resetForwardCaller);
  if (!withProvider) return project;
  return withCuratedFixtureOverride(project, {
    kind: 'declaration',
    source: { model: 'local', namespace: 'impl.cdm.market', kind: 'RosettaFunction', name: 'ReadForwardRateSnapshot' },
    replacement: {
      model: 'local',
      namespace: 'example.resetforward',
      kind: 'RosettaFunction',
      name: 'FixtureForwardRateSnapshot'
    }
  });
}

export function fixtureTrade(date: string, curve: string, nativeDate: (value: string) => unknown) {
  const parties = ['Party1', 'Party2'].map((role) => ({ partyId: [{ identifier: { value: role } }] }));
  return {
    tradeDate: { value: nativeDate('2024-02-27') },
    tradeIdentifier: [{ issuer: { value: 'Fixture' }, assignedIdentifier: [{ identifier: { value: 'RESET-1' } }] }],
    product: {
      economicTerms: {
        payout: [
          {
            settlementPayout: {
              payerReceiver: { payer: 'Party1', receiver: 'Party2' },
              underlier: { Observable: { Asset: cashAsset } },
              settlementTerms: { settlementType: 'Cash', settlementDate: { valueDate: nativeDate(date) } },
              deliveryTerm: curve
            }
          }
        ]
      }
    },
    party: parties,
    counterparty: parties.map((partyReference, index) => ({ role: `Party${index + 1}`, partyReference })),
    tradeLot: [
      {
        priceQuantity: [
          {
            price: [
              {
                value: {
                  value: 1.16,
                  priceType: 'ExchangeRate',
                  unit: { currency: { value: 'USD' } },
                  perUnitOf: { currency: { value: 'EUR' } }
                }
              }
            ],
            quantity: { value: { value: 120, unit: { currency: { value: 'USD' } } } }
          },
          { quantity: { value: { value: 100, unit: { currency: { value: 'EUR' } } } } }
        ]
      }
    ]
  };
}

export function resetForwardInput(test: ResetForwardCase, nativeDate: (value: string) => unknown = (value) => value) {
  if (test.function === 'InterpolateForwardRate') return { maturity: nativeDate(test.date), curve: test.curve };
  const resetHistory = test.history.map(([resetDate, rateRecordDate, value]) => {
    const resetValue = { value, priceType: 'ExchangeRate', unit: { currency: { value: 'USD' } } };
    return {
      resetDate: nativeDate(resetDate),
      ...(rateRecordDate ? { rateRecordDate: nativeDate(rateRecordDate) } : {}),
      resetValue,
      observations: [
        {
          value: {
            observedValue: resetValue,
            observationIdentifier: {
              observable: { Asset: cashAsset },
              observationDate: nativeDate(rateRecordDate ?? resetDate)
            }
          }
        }
      ]
    };
  });
  return {
    tradeState: { trade: fixtureTrade(test.date, 'leap', nativeDate), resetHistory },
    date: nativeDate(test.date)
  };
}
