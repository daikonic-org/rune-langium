// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

export const commodityCalculationPeriods = {
  call: true,
  dependencies: ['@js-temporal/polyfill'],
  expression: `(
    schedule: { period?: 'D' | 'W' | 'M' | 'Y' | 'T'; periodMultiplier?: number; balanceOfFirstPeriod?: boolean } | undefined,
    start: Temporal.PlainDate | undefined,
    end: Temporal.PlainDate | undefined
  ): Temporal.PlainDate[] => {
    if (schedule?.period == null || schedule.periodMultiplier == null) return [];
    if (!start || !end) throw new TypeError('Period boundaries require both dates.');
    const { period, periodMultiplier: step, balanceOfFirstPeriod } = schedule;
    if (!Number.isInteger(step) || step < 1 || step > 2147483647 || (period === 'T' && step !== 1)) {
      throw new RangeError('Period multiplier must be a positive 32-bit integer and 1 for term.');
    }
    if (period === 'T') return Temporal.PlainDate.compare(start, end) < 0 ? [start, end] : [start];
    const duration = {
      D: { days: step },
      W: { weeks: step },
      M: { months: step },
      Y: { years: step }
    }[period];
    if (!duration) throw new TypeError('Unsupported period unit.');
    const dates = [start];
    const alignMonth = period === 'M' && balanceOfFirstPeriod === true;
    let current = start;
    while (Temporal.PlainDate.compare(current, end) < 0) {
      current = alignMonth
        ? current.toPlainYearMonth().add({ months: step }).toPlainDate({ day: 1 })
        : current.add(duration);
      dates.push(current);
    }
    return dates;
  }`
} as const;
