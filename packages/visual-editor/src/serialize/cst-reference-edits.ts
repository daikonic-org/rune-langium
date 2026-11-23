// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { SourceRegion } from '@rune-langium/core';

export type CstReferenceEdit = SourceRegion & { expectedName: string; replacement: string };

export interface ExpressionSource {
  $cstRange?: { offset: number; end: number };
  $cstText?: string;
  $cstReferenceEdits?: readonly CstReferenceEdit[];
}

/** Apply linked name edits to the original source slice, checking each token first. */
export function applyCstReferenceEdits(source: string, offset: number, edits: readonly CstReferenceEdit[]) {
  let edited = '';
  let cursor = 0;
  for (const edit of edits.toSorted((left, right) => left.from - right.from)) {
    const from = edit.from - offset;
    const to = edit.to - offset;
    if (from < cursor || from >= to || to > source.length) return undefined;
    const authored = source.slice(from, to);
    if (authored !== edit.expectedName && authored !== `^${edit.expectedName}`) return undefined;
    edited += source.slice(cursor, from) + edit.replacement;
    cursor = to;
  }
  return edited + source.slice(cursor);
}
