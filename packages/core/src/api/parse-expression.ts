// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { RosettaExpression } from '../generated/ast.js';
import { getSharedServices } from './shared-services.js';

export const EXPRESSION_DRAFT_HOLE = '(<?>)';

/**
 * Result of parsing a bare Rune DSL expression snippet.
 *
 * @remarks
 * `value` is always present — the parser performs best-effort error
 * recovery — so callers MUST check `hasErrors` before trusting the tree
 * (mirrors {@link ParseResult}'s contract).
 *
 * @category Core
 */
export interface ExpressionParseResult {
  /** The root expression node (best-effort when `hasErrors` is true). */
  value: RosettaExpression;
  /** Lexer errors encountered during tokenization. */
  lexerErrors: Array<{ message: string; offset: number; line?: number | undefined; column?: number | undefined }>;
  /** Parser errors encountered during parsing. */
  parserErrors: Array<{
    message: string;
    offset?: number | undefined;
    line?: number | undefined;
    column?: number | undefined;
  }>;
  /** Whether the parse completed without errors. */
  hasErrors: boolean;
}

/**
 * Synchronously parse a bare Rune DSL expression snippet (e.g. a Condition,
 * Operation, or ShortcutDeclaration body) into a typed `RosettaExpression`.
 *
 * @remarks
 * Parses from the grammar's `ExpressionWithAsKey` rule via Langium's
 * `LangiumParser.parse(text, { rule })` — no document, no `DocumentBuilder`,
 * no linking pass. `ExpressionWithAsKey` is a strict superset of `Expression`
 * (its trailing `as-key` is optional), so it covers all three body forms.
 * The project's `RuneDslParser` applies implicit-bracket insertion to the
 * input, exactly as it does for full documents.
 *
 * @useWhen
 * - Parsing an expression body in isolation (editor previews, round-trip tests)
 * - Validating user-typed expression text without a synthetic wrapper document
 *
 * @avoidWhen
 * - You need resolved cross-references — use `parse()`/`parseWorkspace()` with
 *   a full document instead.
 *
 * @pitfalls
 * - Cross-references are NEVER resolved: a bare snippet has no scope at all,
 *   so `ref` is always `undefined` — only `$refText` carries the name. This is
 *   stronger than `parse()`'s cross-file caveat.
 * - Error offsets refer to the implicit-bracket-transformed text, which can
 *   differ slightly from the input (same behavior as `parse()`).
 *
 * @example
 * ```ts
 * import { parseExpression } from '@rune-langium/core';
 * const r = parseExpression('quantity > 0 and price exists');
 * if (!r.hasErrors) console.log(r.value.$type); // 'LogicalOperation'
 * ```
 *
 * @category Core
 */
export function parseExpression(text: string): ExpressionParseResult {
  const { RuneDsl } = getSharedServices();
  const result = RuneDsl.parser.LangiumParser.parse<RosettaExpression>(text, { rule: 'ExpressionWithAsKey' });
  const lexerErrors = result.lexerErrors.map((e) => ({
    message: e.message,
    offset: e.offset,
    line: e.line,
    column: e.column
  }));
  const parserErrors = result.parserErrors.map((e) => ({
    message: e.message,
    offset: e.token?.startOffset,
    line: e.token?.startLine,
    column: e.token?.startColumn
  }));
  return {
    value: result.value,
    lexerErrors,
    parserErrors,
    hasErrors: lexerErrors.length > 0 || parserErrors.length > 0
  };
}

/** Parse a private, incomplete draft without shifting later source ranges. */
export function parseExpressionDraft(text: string): { parsed: ExpressionParseResult; candidate: string } {
  const parsed = parseExpression(text);
  if (!parsed.hasErrors || !text.includes('<?>')) return { parsed, candidate: text };
  const candidate = text.replaceAll(EXPRESSION_DRAFT_HOLE, 'empty').replaceAll('<?>', '_ph');
  return { parsed: parseExpression(candidate), candidate };
}
