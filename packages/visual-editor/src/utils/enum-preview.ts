// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/** Graph cards show a sample; the Inspector owns the complete member list. */
export const ENUM_PREVIEW_LIMIT = 8;

export function enumPreviewLabel(valueCount: number): string {
  return `View all ${valueCount} values`;
}

/** Includes the disclosure row in both graph and Structure layout estimates. */
export function enumPreviewRowCount(valueCount: number): number {
  return Math.min(valueCount, ENUM_PREVIEW_LIMIT) + (valueCount > ENUM_PREVIEW_LIMIT ? 1 : 0);
}
