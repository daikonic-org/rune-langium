// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { referenceFiles, referenceModelSources } from '../../packages/codegen/test/helpers/cdm-reference.js';

export const calculationPeriodDirectory = resolve(
  import.meta.dirname,
  '../fixtures/third-party/cdm-calculation-period'
);
export const calculationPeriodIdentity = 'cdm.observable.asset.calculatedrate.ComputeCalculationPeriod';
export interface CalculationPeriodCase {
  id: string;
  inputs: Record<string, unknown>;
  expected?: Record<string, string>;
  expectedError?: string;
}
export const calculationPeriodCases: CalculationPeriodCase[] = JSON.parse(
  readFileSync(resolve(calculationPeriodDirectory, 'cases.json'), 'utf8')
);

/** Explicit test data, never a production holiday-calendar implementation. */
export const calculationPeriodCalendars = {
  uri: 'file:///model/calculation-period-calendars.rosetta',
  content: readFileSync(
    resolve(import.meta.dirname, '../fixtures/regressions/calculation-period/calendars.rosetta'),
    'utf8'
  )
};
export const calculationPeriodCaller = readFileSync(
  resolve(import.meta.dirname, '../fixtures/regressions/calculation-period/caller.rosetta'),
  'utf8'
);

export function calculationPeriodFiles(withCalendars = true) {
  return [...referenceFiles(calculationPeriodDirectory), ...(withCalendars ? [calculationPeriodCalendars] : [])];
}

/** Preserve the fixture's recorded model ownership when publishing browser artifacts. */
export function calculationPeriodModelSources() {
  return referenceModelSources(calculationPeriodDirectory);
}
