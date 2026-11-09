// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

// One decimal admission/rounding policy supplies each self-contained published body.
const decimalSupport = String.raw`
    type DecimalNumber = { coefficient: bigint; scale: number; negative: boolean };
    const decimal = (input: number): DecimalNumber => {
      if (typeof input !== 'number' || !Number.isFinite(input)) throw new TypeError('Rounding value must be a finite number.');
      const parts = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(input));
      if (!parts?.[2]) throw new TypeError('Invalid decimal number.');
      const fraction = parts[3] ?? '';
      return { coefficient: BigInt(parts[2] + fraction), scale: fraction.length - Number(parts[4] ?? 0), negative: parts[1] === '-' };
    };
    const result = (number: DecimalNumber): number => {
      if (number.coefficient === 0n) return 0;
      const value = Number((number.negative ? '-' : '') + number.coefficient.toString() + 'e' + -number.scale);
      if (!Number.isFinite(value)) throw new RangeError('Rounding result exceeds the finite number profile.');
      return value;
    };
    const direction = (mode: string, allowNearest = true): void => {
      if (mode !== 'Up' && mode !== 'Down' && !(allowNearest && mode === 'Nearest')) throw new TypeError('Unsupported rounding direction.');
    };
    const quotient = (numerator: bigint, denominator: bigint, mode: string): bigint => {
      const whole = numerator / denominator;
      const remainder = numerator % denominator;
      return whole + (remainder !== 0n && (mode === 'Up' || (mode === 'Nearest' && remainder * 2n >= denominator)) ? 1n : 0n);
    };
`;

const quantization = `
    const quantize = (number: DecimalNumber, scale: number, mode: string): DecimalNumber => {
      if (number.coefficient === 0n || scale >= number.scale) return number;
      return { coefficient: quotient(number.coefficient, 10n ** BigInt(number.scale - scale), mode), scale, negative: number.negative };
    };
`;

/** Exact decimal quantization of the finite-number profile; scale formatting is not retained. */
export const roundToPrecision = {
  call: true,
  dependencies: [],
  expression: `(value: number, precision: number, mode: 'Up' | 'Down' | 'Nearest', removeTrailingZeros: boolean): number => {
    ${decimalSupport}${quantization}
    if (!Number.isSafeInteger(precision) || precision < 0) throw new TypeError('Rounding precision must be a nonnegative safe integer.');
    direction(mode);
    if (typeof removeTrailingZeros !== 'boolean') throw new TypeError('removeTrailingZeros must be a boolean.');
    return result(quantize(decimal(value), precision, mode));
  }`
} as const;

export const roundToSignificantFigures = {
  call: true,
  dependencies: [],
  expression: `(value: number, significantFigures: number, mode: 'Up' | 'Down' | 'Nearest'): number => {
    ${decimalSupport}${quantization}
    if (!Number.isSafeInteger(significantFigures) || significantFigures <= 0) throw new TypeError('Significant figures must be a positive safe integer.');
    direction(mode);
    const number = decimal(value);
    return result(quantize(number, number.scale - (number.coefficient.toString().length - significantFigures), mode));
  }`
} as const;

export const roundToNearest = {
  call: true,
  dependencies: [],
  expression: `(value: number, nearest: number, mode: 'Up' | 'Down'): number => {
    ${decimalSupport}
    direction(mode, false);
    const number = decimal(value);
    const increment = decimal(nearest);
    if (nearest <= 0) throw new TypeError('Rounding increment must be positive.');
    if (number.coefficient === 0n) return 0;
    const difference = increment.scale - number.scale;
    const numerator = number.coefficient * (difference > 0 ? 10n ** BigInt(difference) : 1n);
    const denominator = increment.coefficient * (difference < 0 ? 10n ** BigInt(-difference) : 1n);
    let a = numerator, b = denominator;
    while (b !== 0n) { const remainder = a % b; a = b; b = remainder; }
    let factor = denominator / a;
    for (const prime of [2n, 5n]) while (factor % prime === 0n) factor /= prime;
    if (factor !== 1n) throw new RangeError('Non-terminating decimal expansion; no exact representable decimal result.');
    return result({ coefficient: quotient(numerator, denominator, mode) * increment.coefficient, scale: increment.scale, negative: number.negative });
  }`
} as const;
