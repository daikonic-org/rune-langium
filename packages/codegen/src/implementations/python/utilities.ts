// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
/** Gregorian/date/string helpers belong to the shared standalone Python runtime. */
export const utilities = {
  AddDays: {
    call: true,
    dependencies: ['rune_calendar_add_days'],
    expression: 'lambda base, days: rune_calendar_add_days(base, days)'
  },
  DateDifference: {
    call: true,
    dependencies: ['rune_date_days'],
    expression: 'lambda first, second: rune_date_days(second) - rune_date_days(first)'
  },
  LeapYearDateDifference: {
    call: true,
    dependencies: ['rune_leap_year_days'],
    expression: 'lambda first, second: rune_leap_year_days(second) - rune_leap_year_days(first)'
  },
  DayOfWeek: {
    call: true,
    dependencies: ['rune_date_days'],
    expression:
      'lambda value: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"][(rune_date_days(value) - rune_date_days("1970-01-05")) % 7]'
  },
  ToTime: {
    call: true,
    dependencies: ['rune_native_time'],
    expression: 'lambda hours, minutes, seconds: rune_native_time(hours, minutes, seconds)'
  },
  Now: {
    dependencies: ['datetime'],
    expression: 'datetime.now(timezone.utc).replace(microsecond=0).isoformat() + "[UTC]"'
  },
  PopOffDateList: { call: true, dependencies: ['rune_list'], expression: 'lambda values: rune_list(values)[:-1]' },
  StringContains: {
    call: true,
    dependencies: ['rune_string_contains'],
    expression: 'lambda value, needle: rune_string_contains(value, needle)'
  }
} as const;
