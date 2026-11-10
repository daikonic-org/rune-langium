// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/** Rune admits padded integral parts in decimals. Strict ECMAScript does not. */
export function renderTypeScriptNumberLiteral(text: string): string {
  return text.replace(/^([+-]?)0+(?=\d)/, '$1');
}
