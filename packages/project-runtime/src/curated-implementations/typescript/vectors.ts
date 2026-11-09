// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { decimalSupport } from './decimal.js';

const multiplication = `
    const multiply = (left: DecimalNumber, right: DecimalNumber): DecimalNumber => ({ coefficient: left.coefficient * right.coefficient, scale: left.scale + right.scale, negative: left.negative !== right.negative });
`;

const arithmetic = `${multiplication}
    const signed = (value: DecimalNumber): bigint => value.negative ? -value.coefficient : value.coefficient;
    const fromSigned = (value: bigint, scale: number): DecimalNumber => ({ coefficient: value < 0n ? -value : value, scale, negative: value < 0n });
`;

export const vectorOperation = {
  call: true,
  dependencies: [],
  expression: `(operation: string, left: number[], right: number[]): number[] => {
    ${decimalSupport('Vector')}${arithmetic}
    if (!['Add', 'Subtract', 'Multiply', 'Divide', 'Max', 'Min'].includes(operation)) throw new TypeError('Unsupported vector arithmetic operation.');
    const lhs = left.map(decimal), rhs = right.map(decimal);
    const zero: DecimalNumber = { coefficient: 0n, scale: 0, negative: false };
    const values: number[] = [];
    for (let i = 0; i < Math.max(lhs.length, rhs.length); i++) {
      const a = lhs[i] ?? zero, b = rhs[i] ?? zero;
      const scale = Math.max(a.scale, b.scale);
      const x = signed(a) * 10n ** BigInt(scale - a.scale), y = signed(b) * 10n ** BigInt(scale - b.scale);
      let value: DecimalNumber;
      switch (operation) {
        case 'Add': value = fromSigned(x + y, scale); break;
        case 'Subtract': value = fromSigned(x - y, scale); break;
        case 'Multiply': value = multiply(a, b); break;
        case 'Max': value = x >= y ? a : b; break;
        case 'Min': value = x <= y ? a : b; break;
        case 'Divide': {
          // The handwritten reference logs an arithmetic error and omits that pair.
          if (b.coefficient === 0n) continue;
          const shift = b.scale - a.scale + 10;
          const numerator = a.coefficient * (shift > 0 ? 10n ** BigInt(shift) : 1n);
          const denominator = b.coefficient * (shift < 0 ? 10n ** BigInt(-shift) : 1n);
          const whole = numerator / denominator, remainder = numerator % denominator;
          const rounded = whole + (remainder * 2n > denominator || (remainder * 2n === denominator && whole % 2n !== 0n) ? 1n : 0n);
          value = { coefficient: rounded, scale: 10, negative: a.negative !== b.negative };
          break;
        }
        default: throw new TypeError('Unsupported vector arithmetic operation.');
      }
      values.push(result(value));
    }
    return values;
  }`
} as const;

export const vectorGrowthOperation = {
  call: true,
  dependencies: [],
  expression: `(baseValue: number, factors: number[]): number[] => {
    ${decimalSupport('Vector')}${multiplication}
    let value = decimal(baseValue);
    const values = [result(value)];
    for (const factor of factors) {
      value = multiply(value, decimal(factor));
      values.push(result(value));
    }
    return values;
  }`
} as const;
