// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

export const commodityCalculationPeriods = {
  call: true,
  dependencies: ['rune_calendar_period_boundaries'],
  expression: `(lambda schedule, start, end:
    [] if schedule is None or schedule.get('period') is None or schedule.get('periodMultiplier') is None
    else rune_calendar_period_boundaries(
      start, end, {'D': 'days', 'W': 'weeks', 'M': 'months', 'Y': 'years', 'T': 'term'}.get(schedule['period']),
      schedule['periodMultiplier'], align_month_start=schedule.get('balanceOfFirstPeriod') is True
    )
  )`
} as const;
