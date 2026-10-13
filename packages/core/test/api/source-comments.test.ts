// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, it, expect } from 'vitest';
import { getSourceComments } from '../../src/api/source-comments.js';

describe('canonical lexer comment ranges', () => {
  it('excludes comment-like text in strings and preserves UTF-16/CRLF ranges', () => {
    const source =
      'namespace test\r\nversion "// literal 🧭"\r\n// owner 🧭\r\ntype Thing: <"/* literal */">\r\n  field /* actual 🧭 */ string (1..1) // trailing';
    const comments = getSourceComments(source);
    expect(comments.map((comment) => comment.text)).toEqual(['// owner 🧭', '/* actual 🧭 */', '// trailing']);
    for (const comment of comments) expect(source.slice(comment.offset, comment.end)).toBe(comment.text);
    expect(comments.at(-1)?.end).toBe(source.length);
  });
});
