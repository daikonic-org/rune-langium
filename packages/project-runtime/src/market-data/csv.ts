// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/** The BoE and ECB feeds use quoted CSV, including commas and line breaks within fields. */
export function benchmarkCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false,
    closed = false;
  const endField = () => {
    row.push(field);
    field = '';
    closed = false;
  };
  const endRow = () => {
    endField();
    if (row.length !== 1 || row[0] !== '') rows.push(row);
    row = [];
  };
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char !== '"') field += char;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = false;
        closed = true;
      }
    } else if (char === ',') endField();
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else if (char === '"' && field === '' && !closed) quoted = true;
    else if (closed || char === '"') throw new Error('Invalid benchmark CSV quoting.');
    else field += char;
  }
  if (quoted) throw new Error('Unterminated benchmark CSV field.');
  if (field || row.length || closed) endRow();
  const headers = rows.shift();
  if (!headers?.length || headers.some((header) => !header) || new Set(headers).size !== headers.length)
    throw new Error('Invalid benchmark CSV header.');
  return {
    headers,
    rows: rows.map((row) => {
      if (row.length !== headers.length) throw new Error('Invalid benchmark CSV column count.');
      return Object.fromEntries(headers.map((header, index) => [header, row[index] ?? '']));
    })
  };
}
