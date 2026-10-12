// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { getSharedServices } from './shared-services.js';

export interface SourceComment {
  offset: number;
  end: number;
  text: string;
}

/** Hidden comment tokens, in UTF-16 source coordinates; string literals are not comments. */
export function getSourceComments(source: string): readonly SourceComment[] {
  return getSharedServices()
    .RuneDsl.parser.Lexer.tokenize(source)
    .hidden.filter((token) => token.tokenType.name === 'SL_COMMENT' || token.tokenType.name === 'ML_COMMENT')
    .map((token) => ({ offset: token.startOffset, end: token.endOffset! + 1, text: token.image }));
}
