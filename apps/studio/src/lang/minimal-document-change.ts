// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import type { ChangeSpec } from '@codemirror/state';
import { withInstrumentation } from '../services/instrumentation/core.js';

/** Keep unchanged text positions intact when installing a refreshed document. */
export const minimalDocumentChange = withInstrumentation(
  function minimalDocumentChange(before: string, after: string): ChangeSpec {
    let from = 0;
    while (from < before.length && from < after.length && before[from] === after[from]) from++;
    let oldEnd = before.length;
    let newEnd = after.length;
    while (oldEnd > from && newEnd > from && before[oldEnd - 1] === after[newEnd - 1]) {
      oldEnd--;
      newEnd--;
    }
    return { from, to: oldEnd, insert: after.slice(from, newEnd) };
  },
  { op: 'minimalDocumentChange' }
);
