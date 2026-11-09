// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

export const finiteNumber = (name: string) =>
  `isinstance(${name}, (int, float)) and not isinstance(${name}, bool) and abs(${name}) <= 1.7976931348623157e308`;

/** Convert only at the public output boundary, retaining exact intermediate state. */
export const finiteResult = (
  subject: string
) => `(lambda number: (lambda value: value if abs(value) <= 1.7976931348623157e308 else
  (_ for _ in ()).throw(OverflowError(${JSON.stringify(subject + ' result exceeds the finite number profile.')}))
)(0.0 if number == 0 else float(number)))`;
