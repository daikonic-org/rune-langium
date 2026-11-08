// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/** Published self-contained expression; decimal is Python's standard library, not a host callback. */
export const roundToPrecision = {
  call: true,
  dependencies: ['decimal'],
  expression: `(lambda value, precision, mode, remove_trailing_zeros:
    (lambda decimal, places:
      (lambda number:
        (0.0 if number == 0 else float(number)) if places >= -number.as_tuple().exponent else
        (lambda rounded: 0.0 if rounded == 0 else float(rounded))(
          decimal.Context(
            prec=max(1, len(number.as_tuple().digits), number.adjusted() + places + 2),
            rounding={'Up': decimal.ROUND_UP, 'Down': decimal.ROUND_DOWN, 'Nearest': decimal.ROUND_HALF_UP}[mode]
          ).quantize(number, decimal.Decimal((0, (1,), -places)))
        )
      )(decimal.Decimal(str(float(value))))
    )(__import__('decimal'), int(precision))
    if isinstance(value, (int, float)) and not isinstance(value, bool) and abs(value) <= 1.7976931348623157e308
       and isinstance(precision, (int, float)) and not isinstance(precision, bool) and 0 <= precision <= 9007199254740991 and precision == int(precision)
       and mode in ('Up', 'Down', 'Nearest') and isinstance(remove_trailing_zeros, bool)
    else (_ for _ in ()).throw(TypeError('Rounding requires a finite number, nonnegative safe integer precision, supported direction and boolean removeTrailingZeros.'))
  )`
} as const;
