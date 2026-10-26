// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/** datetime/timezone are provided by the shared standalone Python runtime. */
export const today = {
  expression: 'datetime.now(timezone.utc).date().isoformat()',
  dependencies: ['datetime']
} as const;
