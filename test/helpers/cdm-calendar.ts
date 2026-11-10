// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { referenceFiles } from '../../packages/codegen/test/helpers/cdm-reference.js';
import { publishedRuneFiles } from './curated-implementations.js';

export const calendarDirectory = resolve(import.meta.dirname, '../fixtures/third-party/cdm-calendar');
export const calendarNamespace = 'cdm.base.datetime';
export const calendarFunctions = [
  'AddDays',
  'DateDifference',
  'DayOfWeek',
  'LeapYearDateDifference',
  'ResolveAdjustableDate',
  'ResolveAdjustableDates'
] as const;

export interface CalendarCase {
  id: string;
  function: (typeof calendarFunctions)[number];
  inputs: Record<string, unknown>;
  expected: string | number | string[] | null;
}

export const calendarCases: CalendarCase[] = JSON.parse(readFileSync(resolve(calendarDirectory, 'cases.json'), 'utf8'));

export const calendarCaller = {
  uri: 'file:///model/calendar-caller.rosetta',
  content: `namespace example.calendar
import cdm.base.datetime.*

func AdjustWeekend:
    inputs:
        value date (1..1)
        convention BusinessDayConventionEnum (1..1)
    output: adjusted date (0..1)
    set adjusted: ResolveAdjustableDate(AdjustableOrRelativeDate {
        adjustableDate: AdjustableDate {
            unadjustedDate: value,
            dateAdjustments: BusinessDayAdjustments { businessDayConvention: convention }
        }
    })

func AdjustWeekendList:
    inputs:
        value date (1..1)
        convention BusinessDayConventionEnum (1..1)
    output: adjusted date (0..*)
    set adjusted: ResolveAdjustableDates(AdjustableRelativeOrPeriodicDates {
        adjustableDates: AdjustableDates {
            unadjustedDate: [value],
            dateAdjustments: BusinessDayAdjustments { businessDayConvention: convention }
        }
    })
`
};

export function calendarFiles() {
  return [...referenceFiles(calendarDirectory), ...publishedRuneFiles(calendarNamespace, calendarFunctions)];
}
