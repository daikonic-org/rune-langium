// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/** UTC calendar date, using the same Temporal dependency as generated Rune dates. */
export const today = {
  expression: "Temporal.Now.plainDateISO('UTC')",
  dependencies: ['@js-temporal/polyfill']
} as const;
