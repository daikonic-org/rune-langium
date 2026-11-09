// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const commodityPeriodsDirectory = resolve(import.meta.dirname, '../fixtures/third-party/cdm-commodity-periods');
export const commodityPeriodsFunction = {
  namespace: 'cdm.ingest.fpml.confirmation.product.commodityoption',
  name: 'CalculateCommodityCalculationPeriods',
  kind: 'RosettaFunction'
} as const;

interface CommodityPeriodsCase {
  id: string;
  inputs: {
    fpmlCommodityCalculationPeriodsSchedule?: {
      period?: string;
      periodMultiplier?: number;
      balanceOfFirstPeriod?: boolean;
    };
    effectiveDate?: string;
    terminationDate?: string;
  };
  expected?: string[];
  expectedError?: string;
}

export const commodityPeriodsCases: CommodityPeriodsCase[] = JSON.parse(
  readFileSync(resolve(commodityPeriodsDirectory, 'cases.json'), 'utf8')
);

export const commodityPeriodsCaller = {
  uri: 'file:///model/commodity-periods-caller.rosetta',
  content: `namespace example.commodity
import cdm.ingest.fpml.confirmation.product.commodityoption.*
import fpml.consolidated.com.*
import fpml.consolidated.fpmlenum.*

func MonthlyCommodityBoundaries:
    inputs:
        startDate date (1..1)
        endDate date (1..1)
    output: boundaries date (0..*)
    set boundaries: CalculateCommodityCalculationPeriods(CommodityCalculationPeriodsSchedule {
        period: PeriodExtendedEnum -> M,
        periodMultiplier: 1
    }, startDate, endDate)
`
};
