// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { ExpressionScopeEntry } from '@rune-langium/core';
import type { FunctionScope } from '../store/expression-store.js';

/** Presentation groups for canonical core scope descriptions. */
export function expressionScopeFromEntries(entries: readonly ExpressionScopeEntry[]): FunctionScope {
  return {
    inputs: entries.filter((entry) => entry.kind === 'input'),
    output: entries.find((entry) => entry.kind === 'output') ?? null,
    aliases: entries.filter((entry) => entry.kind === 'alias'),
    attributes: entries.filter((entry) => entry.kind === 'attribute' || entry.kind === 'local'),
    references: entries.filter((entry) => entry.kind === 'callable' || entry.kind === 'enum' || entry.kind === 'choice')
  };
}
