// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { finiteNumber, finiteResult } from './numbers.js';

const fraction = (value: string) => `Fraction(str(float(${value})))`;

export const vectorOperation = {
  call: true,
  dependencies: ['fractions', 'itertools'],
  expression: `(lambda operation, left, right:
    (lambda Fraction, zip_longest, result: [result(
      a + b if operation == 'Add' else a - b if operation == 'Subtract' else
      a * b if operation == 'Multiply' else round(a / b, 10) if operation == 'Divide' else
      max(a, b) if operation == 'Max' else min(a, b)
    ) for a, b in zip_longest((${fraction('value')} for value in left),
      (${fraction('value')} for value in right), fillvalue=Fraction(0)) if operation != 'Divide' or b != 0]
    )(__import__('fractions').Fraction, __import__('itertools').zip_longest, ${finiteResult('Vector')})
    if operation in ('Add', 'Subtract', 'Multiply', 'Divide', 'Max', 'Min') and
      all(${finiteNumber('value')} for value in left) and all(${finiteNumber('value')} for value in right)
    else (_ for _ in ()).throw(TypeError('VectorOperation requires an arithmetic operation and finite numeric vectors.'))
  )`
} as const;

export const vectorGrowthOperation = {
  call: true,
  dependencies: ['fractions', 'itertools'],
  expression: `(lambda base_value, factors:
    (lambda Fraction, accumulate, result: [result(value) for value in
      accumulate((${fraction('value')} for value in factors), lambda a, b: a * b, initial=${fraction('base_value')})]
    )(__import__('fractions').Fraction, __import__('itertools').accumulate, ${finiteResult('Vector')})
    if ${finiteNumber('base_value')} and all(${finiteNumber('value')} for value in factors)
    else (_ for _ in ()).throw(TypeError('VectorGrowthOperation requires a finite baseValue and finite numeric factors.'))
  )`
} as const;
