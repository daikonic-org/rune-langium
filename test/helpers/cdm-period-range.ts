// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { referenceFiles } from '../../packages/codegen/test/helpers/cdm-reference.js';
import { publishedRuneFiles } from './curated-implementations.js';

export const periodRangeDirectory = resolve(import.meta.dirname, '../fixtures/third-party/cdm-period-range');
export const periodRangeIdentity = 'cdm.product.common.schedule.CalculationPeriodRange';
export const periodRangePath = 'model/implementations/cdm/period-range.rosetta';

export interface PeriodRangeCase {
  id: string;
  inputs: {
    startDate?: string;
    endDate?: string;
    dateAdjustments?: { businessDayConvention: string };
  };
  expected?: {
    startDate: string;
    endDate: string;
    daysInPeriod: number;
    daysInLeapYearPeriod: number;
    isFirstPeriod: boolean;
    isLastPeriod: boolean;
  };
  expectedError?: string;
}

export const periodRangeCases: PeriodRangeCase[] = JSON.parse(
  readFileSync(resolve(periodRangeDirectory, 'cases.json'), 'utf8')
);

export const periodRangeCaller = {
  uri: 'file:///model/period-range-caller.rosetta',
  content: `namespace example.periodrange
import cdm.base.datetime.*
import cdm.product.common.schedule.*
import cdm.product.asset.calculation.*

func BuildPeriodRange:
    inputs:
        startDate date (0..1)
        endDate date (0..1)
        dateAdjustments BusinessDayAdjustments (0..1)
    output: result CalculationPeriodData (1..1)
    set result: CalculationPeriodRange(startDate, endDate, dateAdjustments)

func RangeBounds:
    inputs:
        startDate date (1..1)
        endDate date (1..1)
    output: result CalculationPeriodBase (1..1)
    set result: Create_CalculationPeriodBase(CalculationPeriodRange(startDate, endDate, empty))
`
};

export function periodRangeFiles() {
  return [
    ...referenceFiles(periodRangeDirectory),
    periodRangeCaller,
    ...publishedRuneFiles('cdm.base.datetime', ['DateDifference', 'LeapYearDateDifference']),
    ...publishedRuneFiles('cdm.product.common.schedule', ['CalculationPeriodRange'])
  ];
}
