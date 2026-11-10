// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { referenceFiles } from '../../packages/codegen/test/helpers/cdm-reference.js';
import { publishedRuneFiles } from './curated-implementations.js';

export const frequencyDirectory = resolve(import.meta.dirname, '../fixtures/third-party/cdm-frequency');
export const frequencyIdentity = 'cdm.product.common.schedule.PeriodsInYear';
export interface FrequencyCase {
  id: string;
  inputs: { frequency: { period: string; periodMultiplier: number; rollConvention: string } };
  expected?: number;
  expectedError?: string;
  referenceExpected?: number;
  referenceError?: string;
}
export const frequencyCases: FrequencyCase[] = JSON.parse(
  readFileSync(resolve(frequencyDirectory, 'cases.json'), 'utf8')
);
export interface StrataFrequencyCase {
  id: string;
  period?: { years: number; months: number; days: number };
  term?: boolean;
  expected?: number;
  expectedError?: string;
}
export const strataFrequencyCases: StrataFrequencyCase[] = JSON.parse(
  readFileSync(resolve(frequencyDirectory, 'strata-cases.json'), 'utf8')
);
export const frequencyCaller = {
  uri: 'file:///model/frequency-caller.rosetta',
  content: `namespace example.frequency
import cdm.base.datetime.*
import cdm.product.common.schedule.*
func AnnualPeriods:
    inputs: frequency CalculationPeriodFrequency (1..1)
    output: result int (1..1)
    set result: PeriodsInYear(frequency)
`
};
export function frequencyFiles(withImplementation = true) {
  return [
    ...referenceFiles(frequencyDirectory),
    frequencyCaller,
    ...(withImplementation ? publishedRuneFiles('cdm.product.common.schedule', ['PeriodsInYear']) : [])
  ];
}
