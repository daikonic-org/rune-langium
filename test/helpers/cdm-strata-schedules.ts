// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prepareCdmCodeLists } from '../../packages/project-runtime/src/curated-implementations/code-list-resources.js';
import { createCuratedRuneProject } from './curated-rune-project.js';

const directory = resolve(import.meta.dirname, '../fixtures/third-party/cdm-strata-schedules');
const manifest: {
  declarations: { namespace: string; name: string; kind: 'RosettaFunction' }[];
  references: { name: string; sha256: string; upstream: { path: string } }[];
} = JSON.parse(readFileSync(resolve(directory, 'sources.json'), 'utf8'));
export const scheduleDeclarations = manifest.declarations;
export const scheduleCases: {
  id: string;
  function: 'CalculationPeriod' | 'CalculationPeriods';
  inputs: { calculationPeriodDates: unknown; date?: string | null };
  expected?: unknown;
  expectedError?: string;
  expectedPythonError?: string;
}[] = JSON.parse(readFileSync(resolve(directory, 'cases.json'), 'utf8'));

export const scheduleCaller = {
  uri: 'file:///model/schedules.rosetta',
  content: `namespace example.schedules
import cdm.base.datetime.*
import cdm.product.common.schedule.*

func MonthlyScheduleDates:
    inputs:
        startDate date (1..1)
        endDate date (1..1)
    output: dates CalculationPeriodDates (1..1)
    set dates: CalculationPeriodDates {
        effectiveDate: AdjustableOrRelativeDate { adjustableDate: AdjustableDate { unadjustedDate: startDate } },
        terminationDate: AdjustableOrRelativeDate { adjustableDate: AdjustableDate { unadjustedDate: endDate } },
        calculationPeriodFrequency: CalculationPeriodFrequency {
            period: PeriodExtendedEnum -> M, periodMultiplier: 1, rollConvention: RollConventionEnum -> EOM
        }
    }

func PickMonthlyPeriod:
    inputs:
        startDate date (1..1)
        endDate date (1..1)
        targetDate date (1..1)
    output: result CalculationPeriodData (1..1)
    set result: CalculationPeriod(MonthlyScheduleDates(startDate, endDate), targetDate)

func ListMonthlyPeriods:
    inputs:
        startDate date (1..1)
        endDate date (1..1)
    output: result CalculationPeriodData (0..*)
    set result: CalculationPeriods(MonthlyScheduleDates(startDate, endDate))
`
};

export function createCuratedScheduleProject() {
  const resources = manifest.references
    .filter(({ name }) => name.startsWith('resources/'))
    .map(({ name, upstream, sha256 }) => {
      const content = readFileSync(resolve(directory, name), 'utf8');
      if (createHash('sha256').update(content).digest('hex') !== sha256)
        throw new Error('Pinned resource changed: ' + name);
      return { path: upstream.path, content };
    });
  return createCuratedRuneProject(directory, scheduleCaller, prepareCdmCodeLists(resources));
}
