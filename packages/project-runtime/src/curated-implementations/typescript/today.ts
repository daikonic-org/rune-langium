// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/** Publication source for a UTC calendar date. */
export const today = {
  expression: "Temporal.Now.plainDateISO('UTC')",
  dependencies: ['@js-temporal/polyfill']
} as const;
