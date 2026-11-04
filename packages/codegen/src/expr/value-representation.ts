// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { ExpressionTranspilerContext } from './transpiler.js';

/** Value representation is independent of how a predicate reports errors. */
export function usesNativeValues(ctx: Pick<ExpressionTranspilerContext, 'emitMode' | 'nativeValues'>): boolean {
  return ctx.nativeValues ?? ctx.emitMode.startsWith('ts-');
}
