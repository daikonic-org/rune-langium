// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
/** Content for a JavaScript/TypeScript single-quoted literal, including data-derived labels and codes. */
export function escapeSingleQuotedString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
