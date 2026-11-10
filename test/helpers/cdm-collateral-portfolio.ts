// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createProjectDraftSnapshot, type ProjectSnapshot } from '../../packages/project-config/src/index.js';
import { createCuratedRuneProject, withCuratedFixtureOverride } from './curated-rune-project.js';

const directory = resolve(import.meta.dirname, '../fixtures/third-party/cdm-collateral-portfolio');

export const collateralPortfolioCaller = {
  uri: 'file:///model/collateral-portfolio.rosetta',
  content: `namespace example.collateral
import cdm.base.math.*
import cdm.base.staticdata.asset.common.*
import cdm.base.staticdata.party.*
import cdm.event.common.Lineage
import cdm.event.position.*
import cdm.observable.asset.*
import cdm.product.asset.*
import cdm.product.collateral.*
import cdm.product.template.*
import impl.cdm.collateral.*
import impl.cdm.portfolio.*

typeAlias ListedCurrency: string

func FixtureEconomicTerms:
    output: result EconomicTerms (1..1)
    set result: EconomicTerms {
        payout: [Payout {
            InterestRatePayout: InterestRatePayout {
                payerReceiver: PayerReceiver { payer: Party1, receiver: Party2 }
            }
        }]
    }

func PublishedCollateralEligibility:
    inputs: currency ListedCurrency (1..1)
    output: result CheckEligibilityResult (0..1)

    alias specification: EligibleCollateralSpecification {
        criteria: [EligibleCollateralCriteria {
            collateralCriteria: CollateralCriteria { CurrencyCodeEnum: (currency to-string) to-enum CurrencyCodeEnum },
            treatment: CollateralTreatment {
                isIncluded: True,
                valuationTreatment: CollateralValuationTreatment { haircutPercentage: 0.05 }
            }
        }]
    }
    alias product: TransferableProduct {
        asset: Asset {
            Instrument: Instrument {
                Security: Security {
                    assetType: AssetTypeEnum -> Security,
                    securityType: SecurityTypeEnum -> Debt,
                    identifier: [AssetIdentifier { identifier: "JGB", identifierType: AssetIdTypeEnum -> Name }]
                }
            }
        },
        economicTerms: FixtureEconomicTerms(),
        productPartyRole: Party1
    }
    set result: CheckEligibilityForProduct([specification], product)

func FixtureProductEligibility:
    inputs:
        specifications EligibleCollateralSpecification (1..*)
        product TransferableProduct (1..1)
    output: details ProductEligibilityInputs (1..1)

    alias instrumentId: product -> asset ->> identifier only-element -> identifier

    set details: ProductEligibilityInputs {
        query: EligibilityQuery {
            maturity: 5,
            collateralAssetType: AssetType { assetType: AssetTypeEnum -> Security, securityType: SecurityTypeEnum -> Debt },
            assetCountryOfOrigin: ISOCountryCodeEnum -> JP,
            denominatedCurrency: CurrencyCodeEnum -> JPY,
            agencyRating: AgencyRatingCriteria {
                creditNotation: CreditNotation { agency: CreditRatingAgencyEnum -> StandardAndPoors, notation: "AA" }
            },
            issuerType: CollateralIssuerType { issuerType: CollateralEntityTypeEnum -> SovereignCentralBank },
            issuerName: LegalEntity { name: "Government of Japan" }
        },
        specification:
            if instrumentId = "OFFERED" then specifications last
            else if instrumentId = "FOREIGN" then EligibleCollateralSpecification {
                criteria: [EligibleCollateralCriteria {
                    collateralCriteria: CollateralCriteria { CurrencyCodeEnum: CurrencyCodeEnum -> GBP },
                    treatment: CollateralTreatment { isIncluded: True }
                }]
            }
    }

func FixturePortfolioAggregation:
    inputs: portfolio Portfolio (1..1)
    output: details PortfolioAggregationInputs (1..1)

    alias parameters: portfolio -> aggregationParameters
    alias filters: parameters -> productQualifier
    alias amount: if parameters -> totalPosition then 100 else 0
    alias shares: UnitType { financialUnit: FinancialUnitEnum -> Share }
    alias usd: UnitType { currency: "USD" with-meta { scheme: "urn:fixture:currency" } }
    alias openingShares: PriceQuantity {
        price: [Price { value: 12, unit: usd, perUnitOf: shares, priceType: PriceTypeEnum -> AssetPrice }],
        quantity: NonNegativeQuantitySchedule {
            value: amount,
            unit: shares,
            datedValue: if filters contains "dated" then [
                NonNegativeDatedValue { date: date { year: 2024, month: 1, day: 31 }, value: 103 }
            ]
        }
    }
    alias openingUsd: PriceQuantity {
        quantity: NonNegativeQuantitySchedule { value: 4, unit: usd }
    }
    alias group: PortfolioPositionGroup {
        product: NonTransferableProduct {
            identifier: [ProductIdentifier { identifier: "SAMPLE", source: ProductIdTypeEnum -> Other }],
            economicTerms: FixtureEconomicTerms()
        },
        series: [
            PortfolioQuantitySeries {
                opening: openingShares,
                changes:
                    if filters contains "opening-only" then []
                    else if filters contains "negative" then [-101]
                    else [10, -3]
            },
            PortfolioQuantitySeries { opening: openingUsd, changes: [3] }
        ]
    }
    set details: PortfolioAggregationInputs {
        groups: if parameters -> positionStatus <> PositionStatusEnum -> Settled then [group],
        lineage: Lineage { portfolioStateReference: portfolio -> portfolioState as-key }
    }
`
};

export async function createCuratedCollateralPortfolioProject(withProviders = true) {
  const project = await createCuratedRuneProject(directory, collateralPortfolioCaller);
  if (!withProviders) return project;
  const currencyList = new Map([
    ['resources/currency.json', readFileSync(resolve(directory, '../currency-list/currency.json'), 'utf8')]
  ]);
  const withCurrencyList = (snapshot: ProjectSnapshot) => createProjectDraftSnapshot(snapshot, currencyList, () => []);
  const [snapshot, installed] = await Promise.all([
    withCurrencyList(project.snapshot),
    withCurrencyList(project.installed)
  ]);
  return withCuratedFixtureOverride(
    { ...project, snapshot, installed },
    {
      kind: 'resource',
      source: { model: 'local', id: 'example.collateral.ListedCurrency#RosettaTypeAlias' },
      path: 'resources/currency.json'
    },
    {
      kind: 'declaration',
      source: {
        model: 'local',
        namespace: 'impl.cdm.collateral',
        kind: 'RosettaFunction',
        name: 'ReadProductEligibilityInputs'
      },
      replacement: {
        model: 'local',
        namespace: 'example.collateral',
        kind: 'RosettaFunction',
        name: 'FixtureProductEligibility'
      }
    },
    {
      kind: 'declaration',
      source: {
        model: 'local',
        namespace: 'impl.cdm.portfolio',
        kind: 'RosettaFunction',
        name: 'ReadPortfolioAggregationInputs'
      },
      replacement: {
        model: 'local',
        namespace: 'example.collateral',
        kind: 'RosettaFunction',
        name: 'FixturePortfolioAggregation'
      }
    }
  );
}

export function collateralProduct(identifier: string) {
  return {
    asset: {
      instrument: {
        security: {
          assetType: 'Security',
          securityType: 'Debt',
          identifier: [{ identifier: { value: identifier }, identifierType: 'Name' }]
        }
      }
    },
    economicTerms: { payout: [] },
    productPartyRole: 'Party1'
  };
}

export function collateralSchedule(currency: string, isIncluded = true) {
  return {
    criteria: [
      {
        collateralCriteria: { currencyCodeEnum: currency },
        treatment: { isIncluded, valuationTreatment: { haircutPercentage: 0.05 } }
      }
    ]
  };
}
