// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
/** Publication sources; selected bodies travel with the curated release. */
export const utilities = {
  ToTime: {
    call: true,
    dependencies: ['@js-temporal/polyfill'],
    expression: `(hour: number, minute: number, second: number) => { if (![hour, minute, second].every(Number.isSafeInteger)) throw new TypeError('Time components must be integers.'); return Temporal.PlainTime.from({ hour, minute, second }, { overflow: 'reject' }); }`
  },
  Now: {
    dependencies: ['@js-temporal/polyfill'],
    expression: `Temporal.Now.zonedDateTimeISO('UTC').with({ millisecond: 0, microsecond: 0, nanosecond: 0 })`
  },
  StringContains: {
    call: true,
    dependencies: [],
    expression: `(value: string | undefined, needle: string) => value == null ? false : value.includes(needle)`
  }
} as const;
