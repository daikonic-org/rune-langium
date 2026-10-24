// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
/** Stable project/export identity without object insertion-order differences. */
export function canonicalProjectJson(value: unknown): string {
  const ordered = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(ordered);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, child]) => [key, ordered(child)])
      );
    return value;
  };
  return JSON.stringify(ordered(value));
}
