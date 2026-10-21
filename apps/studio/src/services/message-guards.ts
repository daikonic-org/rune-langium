// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/** Object guard shared by parser and codegen message boundaries. */
// oxlint-disable-next-line rune/no-uninstrumented-export -- Pure field predicate; callers already instrument the message boundary.
export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}
