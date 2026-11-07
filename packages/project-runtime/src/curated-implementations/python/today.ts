// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/** Publication source using the shared standalone Python runtime. */
export const today = {
  expression: 'datetime.now(timezone.utc).date().isoformat()',
  dependencies: ['datetime']
} as const;
