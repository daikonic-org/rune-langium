// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/** Exact decimal quantization of the existing finite-number profile; scale formatting is not retained. */
export const roundToPrecision = {
  call: true,
  dependencies: [],
  expression: `(value: number, precision: number, mode: 'Up' | 'Down' | 'Nearest', removeTrailingZeros: boolean): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('Rounding value must be a finite number.');
    if (!Number.isSafeInteger(precision) || precision < 0) throw new TypeError('Rounding precision must be a nonnegative safe integer.');
    if (!['Up', 'Down', 'Nearest'].includes(mode)) throw new TypeError('Unsupported rounding direction.');
    if (typeof removeTrailingZeros !== 'boolean') throw new TypeError('removeTrailingZeros must be a boolean.');
    const parts = /^(-?)(\\d+)(?:\\.(\\d+))?(?:e([+-]?\\d+))?$/i.exec(String(value));
    if (!parts) throw new TypeError('Invalid decimal number.');
    const fraction = parts[3] ?? '';
    const scale = fraction.length - Number(parts[4] ?? 0);
    if (precision >= scale || value === 0) return value === 0 ? 0 : value;
    const coefficient = BigInt(parts[2] + fraction);
    const divisor = 10n ** BigInt(scale - precision);
    let rounded = coefficient / divisor;
    const remainder = coefficient % divisor;
    if (remainder !== 0n && (mode === 'Up' || (mode === 'Nearest' && remainder * 2n >= divisor))) rounded += 1n;
    if (rounded === 0n) return 0;
    return Number((parts[1] ?? '') + rounded.toString() + 'e-' + precision);
  }`
} as const;
