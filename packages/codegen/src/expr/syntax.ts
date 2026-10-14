// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/** Property reads and unary operators need parentheses only around compound expressions. */
export function parenthesizeReceiver(value: string): string {
  return /^[\w$]+(?:\??\.[\w$]+)*$/.test(value) ? value : `(${value})`;
}
