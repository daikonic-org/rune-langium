// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
/** Publication sources using the shared standalone Python runtime. */
export const utilities = {
  ToTime: {
    call: true,
    dependencies: ['rune_native_time'],
    expression: 'lambda hours, minutes, seconds: rune_native_time(hours, minutes, seconds)'
  },
  Now: {
    dependencies: ['datetime'],
    expression: 'datetime.now(timezone.utc).replace(microsecond=0).isoformat() + "[UTC]"'
  },
  StringContains: {
    call: true,
    dependencies: ['rune_string_contains'],
    expression: 'lambda value, needle: rune_string_contains(value, needle)'
  }
} as const;
