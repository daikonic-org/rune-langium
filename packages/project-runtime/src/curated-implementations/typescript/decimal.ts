// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/** Exact decimal storage and finite-number admission shared by published native bodies. */
export const decimalSupport = (subject: string) => String.raw`
    type DecimalNumber = { coefficient: bigint; scale: number; negative: boolean };
    const decimal = (input: number): DecimalNumber => {
      if (typeof input !== 'number' || !Number.isFinite(input)) throw new TypeError(${JSON.stringify(subject + ' value must be a finite number.')});
      const parts = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(input));
      if (!parts?.[2]) throw new TypeError('Invalid decimal number.');
      const fraction = parts[3] ?? '';
      return { coefficient: BigInt(parts[2] + fraction), scale: fraction.length - Number(parts[4] ?? 0), negative: parts[1] === '-' };
    };
    const result = (number: DecimalNumber): number => {
      if (number.coefficient === 0n) return 0;
      const value = Number((number.negative ? '-' : '') + number.coefficient.toString() + 'e' + -number.scale);
      if (!Number.isFinite(value)) throw new RangeError(${JSON.stringify(subject + ' result exceeds the finite number profile.')});
      return value;
    };
`;
