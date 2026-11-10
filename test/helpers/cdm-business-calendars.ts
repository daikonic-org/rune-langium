// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prepareCdmCodeLists } from '../../packages/project-runtime/src/curated-implementations/code-list-resources.js';
import { createCuratedRuneProject, curatedFixtureResources } from './curated-rune-project.js';

const directory = resolve(import.meta.dirname, '../fixtures/third-party/cdm-business-calendars');
const manifest: {
  declarations: { namespace: string; name: string; kind: 'RosettaFunction' }[];
} = JSON.parse(readFileSync(resolve(directory, 'sources.json'), 'utf8'));
export const calendarDeclarations = manifest.declarations;
export const calendarCases: ({
  id: string;
  expectedError?: string;
  expected?: string[];
  holidayCount?: number;
  holidayDigest?: string;
} & (
  | { function: 'BusinessCenterHolidays'; inputs: { businessCenter: string } }
  | {
      function: 'GetNonBusinessDates';
      inputs: { businessCenters: string[]; dates?: string[]; period?: Record<string, string> };
    }
))[] = JSON.parse(readFileSync(resolve(directory, 'cases.json'), 'utf8'));

export const businessCalendarCaller = {
  uri: 'file:///model/business-calendars.rosetta',
  content: `namespace example.calendars
import cdm.event.instructioncomposition.reset.*
import cdm.product.common.schedule.*

func FindNonBusinessDates:
    inputs:
        center string (1..1)
        startDate date (1..1)
        endDate date (1..1)
    output: result date (1..*)
    set result:
        GetNonBusinessDates(
            [center],
            CalculationPeriodBase { adjustedStartDate: startDate, adjustedEndDate: endDate },
            empty
        )
`
};

export function createCuratedCalendarProject() {
  return createCuratedRuneProject(
    directory,
    businessCalendarCaller,
    prepareCdmCodeLists([...curatedFixtureResources(directory).values()])
  );
}
