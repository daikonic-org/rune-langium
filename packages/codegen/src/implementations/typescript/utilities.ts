// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
/** Native bodies are trusted generator sources. Calls use the emitter's actual parameter bindings. */
export const utilities = {
  AddDays: {
    call: true,
    dependencies: ['@js-temporal/polyfill'],
    expression: `(base: Temporal.PlainDate, days: number) => { if (!Number.isSafeInteger(days)) throw new TypeError('Calendar days must be a safe integer.'); return Temporal.PlainDate.from(base).add({ days }); }`
  },
  DateDifference: {
    call: true,
    dependencies: ['@js-temporal/polyfill'],
    expression: `(first: Temporal.PlainDate, second: Temporal.PlainDate) => Temporal.PlainDate.from(first).until(Temporal.PlainDate.from(second), { largestUnit: 'days' }).days`
  },
  LeapYearDateDifference: {
    call: true,
    dependencies: ['@js-temporal/polyfill'],
    expression: `(first: Temporal.PlainDate, second: Temporal.PlainDate) => { const tally = (value: Temporal.PlainDate) => { const d = Temporal.PlainDate.from(value), y = d.year - 1; return 366 * (Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400)) + (d.inLeapYear ? Temporal.PlainDate.from({ year: d.year, month: 1, day: 1 }).until(d, { largestUnit: 'days' }).days : 0); }; return tally(second) - tally(first); }`
  },
  DayOfWeek: {
    call: true,
    dependencies: ['@js-temporal/polyfill'],
    expression: `(value: Temporal.PlainDate) => (['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const)[Temporal.PlainDate.from(value).dayOfWeek - 1]!`
  },
  ToTime: {
    call: true,
    dependencies: ['@js-temporal/polyfill'],
    expression: `(hour: number, minute: number, second: number) => { if (![hour, minute, second].every(Number.isSafeInteger)) throw new TypeError('Time components must be integers.'); return Temporal.PlainTime.from({ hour, minute, second }, { overflow: 'reject' }); }`
  },
  Now: {
    dependencies: ['@js-temporal/polyfill'],
    expression: `Temporal.Now.zonedDateTimeISO('UTC').with({ millisecond: 0, microsecond: 0, nanosecond: 0 })`
  },
  PopOffDateList: {
    call: true,
    dependencies: [],
    expression: `(values: readonly Temporal.PlainDate[] | undefined) => (values ?? []).slice(0, -1)`
  },
  StringContains: {
    call: true,
    dependencies: [],
    expression: `(value: string | undefined, needle: string) => value == null ? false : value.includes(needle)`
  }
} as const;
