// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

const finiteNumber = (name: string) =>
  `isinstance(${name}, (int, float)) and not isinstance(${name}, bool) and abs(${name}) <= 1.7976931348623157e308`;
const safeCount = (name: string, minimum = 0) =>
  `isinstance(${name}, (int, float)) and not isinstance(${name}, bool) and ${minimum} <= ${name} <= 9007199254740991 and ${name} == int(${name})`;
const context = (precision: string) => `decimal.Context(
  prec=${precision}, rounding={'Up': decimal.ROUND_UP, 'Down': decimal.ROUND_DOWN, 'Nearest': decimal.ROUND_HALF_UP}[mode],
  Emin=-999999, Emax=999999, capitals=1, clamp=0, flags=[],
  traps=[decimal.InvalidOperation, decimal.DivisionByZero, decimal.Overflow]
)`;

/** Self-contained expressions use only Python's standard library and isolated decimal contexts. */
function rounding(parameters: string, checks: string, operation: string, dependencies: string[] = []) {
  return {
    call: true,
    dependencies: ['decimal', ...dependencies],
    expression: `(lambda ${parameters}:
      (lambda decimal, result: ${operation})(__import__('decimal'),
        (lambda number: (lambda value: value if abs(value) <= 1.7976931348623157e308 else
          (_ for _ in ()).throw(OverflowError('Rounding result exceeds the finite number profile.'))
        )(0.0 if number == 0 else float(number)))
      ) if ${checks} else (_ for _ in ()).throw(TypeError('Rounding requires finite numbers, a valid safe integer count, supported direction and boolean removeTrailingZeros.'))
    )`
  } as const;
}

export const roundToPrecision = rounding(
  'value, precision, mode, remove_trailing_zeros',
  `${finiteNumber('value')} and ${safeCount('precision')} and mode in ('Up', 'Down', 'Nearest') and isinstance(remove_trailing_zeros, bool)`,
  `(lambda number, places: result(number) if places >= -number.as_tuple().exponent else
    result(${context('max(1, len(number.as_tuple().digits), number.adjusted() + places + 2)')}.quantize(number, decimal.Decimal((0, (1,), -places))))
  )(decimal.Decimal(str(float(value))), int(precision))`
);

export const roundToSignificantFigures = rounding(
  'value, significant_figures, mode',
  `${finiteNumber('value')} and ${safeCount('significant_figures', 1)} and mode in ('Up', 'Down', 'Nearest')`,
  `(lambda number, figures: result(number) if figures >= len(number.as_tuple().digits) else
    result(${context('figures')}.create_decimal(number))
  )(decimal.Decimal(str(float(value))), int(significant_figures))`
);

export const roundToNearest = rounding(
  'value, nearest, mode',
  `${finiteNumber('value')} and ${finiteNumber('nearest')} and nearest > 0 and mode in ('Up', 'Down')`,
  `(lambda Fraction:
    (lambda increment:
      (lambda ratio:
        (lambda numerator, denominator: result(
          (numerator // denominator + (1 if mode == 'Up' and numerator % denominator else 0)) * increment * (-1 if value < 0 else 1)
        ) if 10 ** denominator.bit_length() % denominator == 0 else
          (_ for _ in ()).throw(ArithmeticError('Non-terminating decimal expansion; no exact representable decimal result.'))
        )(abs(ratio.numerator), ratio.denominator)
      )(Fraction(decimal.Decimal(str(float(value)))) / increment)
    )(Fraction(decimal.Decimal(str(float(nearest)))))
  )(__import__('fractions').Fraction)`,
  ['fractions']
);
