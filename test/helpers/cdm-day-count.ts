// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { resolve } from 'node:path';

export const dayCountDirectory = resolve(import.meta.dirname, '../fixtures/third-party/cdm-dispatch');

export const dayCountCaller = {
  uri: 'file:///model/day-count.rosetta',
  content: `namespace example.daycount
import cdm.base.datetime.daycount.*

func AfbAccrual:
    inputs:
        startDate date (1..1)
        endDate date (1..1)
    output: fraction number (1..1)
    set fraction: YearFraction(DayCountFractionEnum -> ACT_ACT_AFB, startDate, endDate, empty, empty)
`
};
