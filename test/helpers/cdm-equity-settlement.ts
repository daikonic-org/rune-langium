// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fixtureTrade } from './cdm-reset-forward-rates.js';
import { createCuratedRuneProject, withCuratedFixtureOverride } from './curated-rune-project.js';

const directory = resolve(import.meta.dirname, '../fixtures/third-party/cdm-equity-settlement');
export type EquitySettlementCase = { id: string } & (
  | {
      function: 'NewFloatingPayout';
      confirmationFirstPayment?: string;
      expectedPayment: string;
      periodic: boolean;
    }
  | { function: 'ResolveCashSettlementDate'; periodEnd: string; expectedPayment?: string; error?: string }
);
export const equitySettlementCases: EquitySettlementCase[] = JSON.parse(
  readFileSync(resolve(directory, 'cases.json'), 'utf8')
);

export const equitySettlementCaller = {
  uri: 'file:///model/equity-settlement.rosetta',
  content: `namespace example.equitysettlement
import cdm.base.math.*
import cdm.base.datetime.AdjustableDate
import cdm.base.datetime.daycount.DayCountFractionEnum
import cdm.base.staticdata.asset.common.*
import cdm.base.staticdata.asset.rates.FloatingRateIndexEnum
import cdm.base.staticdata.party.*
import cdm.event.common.*
import cdm.legaldocumentation.transaction.EquitySwapMasterConfirmation2018
import cdm.observable.asset.*
import cdm.observable.common.DeterminationMethodEnum
import cdm.product.asset.*
import cdm.product.common.schedule.*
import cdm.product.common.settlement.*
import impl.cdm.settlement.*

func FixtureEquityFloatingTerms:
    inputs: masterConfirmation EquitySwapMasterConfirmation2018 (0..1)
    output: terms EquityFloatingTerms (1..1)
    set terms: EquityFloatingTerms {
        payerReceiver: PayerReceiver { payer: Party2, receiver: Party1 },
        priceQuantity: ResolvablePriceQuantity {
            resolvedQuantity: Quantity { value: 1000, unit: UnitType { currency: "USD" } }
        },
        floatingRate: FloatingRateSpecification {
            rateOption: InterestRateIndex {
                FloatingRateIndex: FloatingRateIndex {
                    assetType: AssetTypeEnum -> Other,
                    assetClass: AssetClassEnum -> InterestRate,
                    identifier: [AssetIdentifier { identifier: "USD-SOFR", identifierType: AssetIdTypeEnum -> Name }],
                    floatingRateIndex: FloatingRateIndexEnum -> USD_SOFR
                }
            }
        },
        dayCountFraction: (DayCountFractionEnum -> ACT_360) with-meta { scheme: "urn:fixture:day-count" },
        paymentDate: AdjustableDate { adjustedDate: date { year: 2024, month: 6, day: 10 } },
        paymentDelay: False
    }

func FixtureCashSettlementSchedule:
    inputs: tradeState TradeState (1..1)
    output: schedule CashSettlementSchedule (1..1)
    set schedule: CashSettlementSchedule {
        currentPeriodEndDate: tradeState -> trade -> tradeDate,
        periods: [
            CashSettlementPeriod {
                periodEndDate: date { year: 2024, month: 3, day: 29 },
                settlementDate: date { year: 2024, month: 4, day: 3 }
            },
            CashSettlementPeriod {
                periodEndDate: date { year: 2024, month: 2, day: 29 },
                settlementDate: date { year: 2024, month: 3, day: 4 }
            },
            CashSettlementPeriod {
                periodEndDate: date { year: 2024, month: 4, day: 30 },
                settlementDate: date { year: 2024, month: 5, day: 2 }
            },
            CashSettlementPeriod {
                periodEndDate: date { year: 2024, month: 4, day: 30 },
                settlementDate: date { year: 2024, month: 5, day: 3 }
            }
        ]
    }

func FixtureConfirmation:
    inputs: confirmationFirstPayment date (0..1)
    output: confirmation EquitySwapMasterConfirmation2018 (0..1)
    set confirmation:
        if confirmationFirstPayment exists
        then EquitySwapMasterConfirmation2018 {
            typeOfSwapElection: ReturnTypeEnum -> Price,
            pricingMethodElection: PriceReturnTerms { returnType: ReturnTypeEnum -> Price },
            linearInterpolationElection: InterpolationMethodEnum -> Linear,
            settlementTerms: SettlementTerms { settlementType: SettlementTypeEnum -> Cash },
            valuationDates: ValuationDates {
                finalValuationDate: PerformanceValuationDates {
                    determinationMethod: DeterminationMethodEnum -> CalculationAgent
                }
            },
            equityCashSettlementDates: PaymentDates { firstPaymentDate: confirmationFirstPayment }
        }

func PublishedFloatingPayout:
    inputs: confirmationFirstPayment date (0..1)
    output: result InterestRatePayout (1..1)
    set result: NewFloatingPayout(FixtureConfirmation(confirmationFirstPayment))

func PublishedEquitySwapFundingPayout:
    inputs: confirmationFirstPayment date (1..1)
    output: result InterestRatePayout (1..1)
    alias product: NewEquitySwapProduct(
        Security {
            assetType: AssetTypeEnum -> Security,
            securityType: SecurityTypeEnum -> Equity,
            identifier: [AssetIdentifier { identifier: "SAMPLE", identifierType: AssetIdTypeEnum -> Name }]
        },
        FixtureConfirmation(confirmationFirstPayment)
    )
    set result: product -> economicTerms -> payout as InterestRatePayout only-element
`
};

export async function createCuratedEquitySettlementProject(withProviders = true) {
  const project = await createCuratedRuneProject(directory, equitySettlementCaller);
  if (!withProviders) return project;
  return withCuratedFixtureOverride(
    project,
    {
      kind: 'declaration',
      source: {
        model: 'local',
        namespace: 'impl.cdm.settlement',
        kind: 'RosettaFunction',
        name: 'ReadEquityFloatingTerms'
      },
      replacement: {
        model: 'local',
        namespace: 'example.equitysettlement',
        kind: 'RosettaFunction',
        name: 'FixtureEquityFloatingTerms'
      }
    },
    {
      kind: 'declaration',
      source: {
        model: 'local',
        namespace: 'impl.cdm.settlement',
        kind: 'RosettaFunction',
        name: 'ReadCashSettlementSchedule'
      },
      replacement: {
        model: 'local',
        namespace: 'example.equitysettlement',
        kind: 'RosettaFunction',
        name: 'FixtureCashSettlementSchedule'
      }
    }
  );
}

export function equitySettlementInput(
  test: EquitySettlementCase,
  nativeDate: (value: string) => unknown = (date) => date
) {
  if (test.function === 'NewFloatingPayout') {
    return {
      confirmationFirstPayment: test.confirmationFirstPayment ? nativeDate(test.confirmationFirstPayment) : undefined
    };
  }
  return {
    tradeState: {
      trade: {
        ...fixtureTrade(test.periodEnd, 'leap', nativeDate),
        tradeDate: { value: nativeDate(test.periodEnd) }
      }
    }
  };
}

export function equitySettlementTradeState(date: string, nativeDate: (value: string) => unknown = (value) => value) {
  const baseTrade = fixtureTrade(date, 'leap', nativeDate);
  const currency = { currency: { value: 'USD' } };
  const startPrice = { value: 10, unit: currency, perUnitOf: { financialUnit: 'Share' }, priceType: 'AssetPrice' };
  const endPrice = { ...startPrice, value: 11 };
  const underlying = {
    asset: {
      instrument: {
        security: {
          assetType: 'Security',
          securityType: 'Equity',
          identifier: [{ identifier: { value: 'SAMPLE' }, identifierType: 'Name' }]
        }
      }
    }
  };
  return {
    trade: {
      ...baseTrade,
      tradeDate: { value: nativeDate(date) },
      product: {
        economicTerms: {
          payout: [
            {
              performancePayout: {
                payerReceiver: { payer: 'Party1', receiver: 'Party2' },
                priceQuantity: { quantitySchedule: { value: { value: 1000, unit: currency } } },
                valuationDates: {
                  interimValuationDate: {
                    determinationMethod: 'CalculationAgent',
                    valuationDates: {
                      adjustableDates: { adjustedDate: [{ value: nativeDate('2024-03-15') }] }
                    }
                  },
                  finalValuationDate: {
                    determinationMethod: 'CalculationAgent',
                    valuationDate: { adjustableDate: { adjustedDate: { value: nativeDate(date) } } }
                  }
                },
                paymentDates: { firstPaymentDate: nativeDate('2024-04-03') },
                underlier: { observable: underlying },
                returnTerms: { priceReturnTerms: { returnType: 'Price' } }
              }
            }
          ]
        }
      },
      tradeLot: [{ priceQuantity: [{ price: [{ value: startPrice }], observable: underlying }] }]
    },
    resetHistory: [
      {
        resetDate: nativeDate(date),
        resetValue: endPrice,
        observations: [
          {
            value: {
              observedValue: endPrice,
              observationIdentifier: { observable: underlying, observationDate: nativeDate(date) }
            }
          }
        ]
      }
    ]
  };
}
