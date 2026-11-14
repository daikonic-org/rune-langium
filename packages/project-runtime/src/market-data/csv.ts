// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { parse } from 'csv-parse/browser/esm/sync';

/** The BoE and ECB feeds use quoted CSV, including commas and line breaks within fields. */
export function benchmarkCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const rows = parse(text, { bom: true, skip_empty_lines: true });
  const headers = rows.shift();
  if (!headers?.length || headers.some((header) => !header) || new Set(headers).size !== headers.length)
    throw new Error('Invalid benchmark CSV header.');
  return {
    headers,
    rows: rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])))
  };
}
