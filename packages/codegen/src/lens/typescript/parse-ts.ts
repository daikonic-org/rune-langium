// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * TypeScript text → `LensResult` (parse-back), via tree-sitter.
 *
 * Walks a deliberately narrow set of tree-sitter node `.type`s. Anything
 * else — assignments, calls, unguarded `member_expression` (no `?.`), any
 * statement other than a single `expression_statement` — is a refusal,
 * never a degraded node. Node type names below were confirmed against a
 * real parse of each construct (see Step 8's note) — not assumed from
 * grammar documentation.
 */
import type { Node as TsNode } from 'web-tree-sitter';
import type { RosettaExpression } from '@rune-langium/core';
import type { LensResult } from '../language-lens.js';
import { createTsParser, type WasmSource } from './ts-grammar-loader.js';
import { OutOfSubset, refusal, child, field } from '../parse-helpers.js';
import { isRuneValidId } from '../valid-id.js';
import { TS_RESERVED_WORDS } from '../reserved-words.js';

/**
 * `wasmSource` is threaded straight through to `createTsParser` — omit it
 * in Node/test contexts (resolves the package's own `.wasm` from disk);
 * pass fetched bytes explicitly in the browser (see Task 6's studio wiring,
 * which fetches the grammar once via a Vite `?url` asset import and caches
 * the resulting bytes — `ts-wasm-asset.ts` only caches the fetched WASM
 * bytes; `createTsParser` still constructs a new `Parser` instance on
 * every call).
 */
export async function parseTs(text: string, wasmSource?: WasmSource): Promise<LensResult> {
  const parser = await createTsParser(wasmSource);
  const tree = parser.parse(text);
  if (tree === null) {
    return refusal('syntax-error', 'the TypeScript parser returned no tree (empty input?)', 0, text.length);
  }
  const root = tree.rootNode;

  if (root.hasError) {
    const errorNode = root.descendantsOfType('ERROR')[0] ?? root;
    return refusal(
      'syntax-error',
      'syntax error in TypeScript expression',
      errorNode.startIndex,
      errorNode.endIndex - errorNode.startIndex
    );
  }

  if (root.childCount !== 1 || root.child(0)?.type !== 'expression_statement') {
    return refusal('syntax-error', 'expected a single expression', 0, text.length);
  }

  const exprStatement = root.child(0)!;
  const expr = exprStatement.child(0);
  if (!expr) return refusal('syntax-error', 'expected a single expression', 0, text.length);

  try {
    return { ok: true, node: toRosetta(expr) };
  } catch (e) {
    if (e instanceof OutOfSubset) {
      return refusal('out-of-subset', e.message, e.node.startIndex, e.node.endIndex - e.node.startIndex);
    }
    throw e;
  }
}

const COMPARISON_FROM_TS: Record<string, string> = { '<': '<', '<=': '<=', '>': '>', '>=': '>=' };
const EQUALITY_FROM_TS: Record<string, string> = { '===': '=', '!==': '<>' };
const LOGICAL_FROM_TS: Record<string, string> = { '&&': 'and', '||': 'or' };
const ARITHMETIC_FROM_TS: Record<string, string> = { '+': '+', '-': '-', '*': '*', '/': '/' };

/**
 * Shared by `case 'number':` and `case 'unary_expression':` (negative
 * numeric literals) — `text` is the numeric text to convert (with a leading
 * `-` prepended by the unary case), `node` is the tree-sitter node to blame
 * in any refusal.
 */
function numberNodeToRosetta(text: string, node: TsNode): RosettaExpression {
  // Hex/binary/octal prefixes, numeric separators, and the BigInt-literal
  // `n` suffix (e.g. `5n`) have no faithful Rune representation and are
  // refused outright — a bare `BigInt(text)` call on `n`-suffixed text
  // throws a raw, uncaught SyntaxError instead of refusing gracefully.
  // Note: a decimal exponent uses `e`/`E`, not `b`/`B` — the `b`/`B` check
  // here is only about `0b`-style binary prefixes, not exponent forms.
  if (/[xXbBoOn_]/.test(text)) {
    throw new OutOfSubset(
      `number literal '${text}' is not supported (hex/binary/octal/separator/BigInt-literal forms have no Rune equivalent)`,
      node
    );
  }
  // Rune's `BigDecimal` grammar (rune-dsl.langium:881-883) only allows an
  // `e`/`E` exponent suffix AFTER a mantissa that already contains a `.`
  // (`.INT` or `INT.INT?`). A bare integer with an exponent and no decimal
  // point (e.g. `1e5`) is NOT valid Rune BigDecimal syntax, so text like
  // that must be refused outright — accepting it would produce a
  // `RosettaNumberLiteral` whose value string can never be reparsed by
  // Rune's own grammar. We deliberately do NOT normalize by inserting a
  // `.0` (e.g. `1e5` → `1.0e5`): that would break the TS→Rune→TS exact
  // round-trip this lens must preserve, since the normalized Rune text
  // would render back to a different TS string than the user typed.
  if (/[eE]/.test(text) && !text.includes('.')) {
    throw new OutOfSubset(
      `number literal '${text}' is not supported (Rune's BigDecimal grammar requires a decimal point before an exponent — use e.g. '1.0e5' instead of '1e5')`,
      node
    );
  }
  // Decimal or exponential form (with a decimal point) — Rune's
  // `BigDecimal` (a string type) accepts both per its grammar. Preserve
  // the raw source text exactly (no `Number()` round-trip) to avoid any
  // precision loss.
  if (/[.eE]/.test(text)) {
    return { $type: 'RosettaNumberLiteral', value: text } as unknown as RosettaExpression;
  }
  // Plain integer — `RosettaIntLiteral.value` is a real `bigint`;
  // `BigInt(text)` (not `parseInt`) correctly handles arbitrary
  // precision (e.g. `9007199254740993`, which `parseInt`/`Number`
  // would silently round).
  // Strict-mode ES modules (which TS/JS always compile to) forbid a
  // leading zero on a decimal integer literal with more than one digit
  // (SyntaxError: "Octal literals are not allowed in strict mode.") —
  // tree-sitter's `number` token still lexes forms like "01"/"-01" as
  // valid `number` nodes, and BigInt("01") happily returns 1n, so without
  // this check invalid TS/JS input would be silently normalized into
  // valid Rune instead of refused. A bare "0" (no second digit) and a
  // leading zero before a decimal point (e.g. "0.5", which returns
  // earlier via the RosettaNumberLiteral branch above) are unaffected.
  if (/^-?0\d/.test(text)) {
    throw new OutOfSubset(
      `number literal '${text}' is not supported (a leading zero is not valid strict-mode JS/TS syntax — use an explicit 0o prefix for octal, or drop the leading zero)`,
      node
    );
  }
  return { $type: 'RosettaIntLiteral', value: BigInt(text) } as unknown as RosettaExpression;
}

function toRosetta(node: TsNode): RosettaExpression {
  switch (node.type) {
    case 'parenthesized_expression':
      // Children are positional — `(`, expression, `)` — not a named field.
      // Confirmed against a real parse of `(a + b) * c` before writing this.
      return toRosetta(child(node, 1));

    case 'binary_expression': {
      const left = field(node, 'left');
      const right = field(node, 'right');
      const op = child(node, 1).text;

      // `x != null` / `x == null` are the presence idiom, not literal
      // equality — Rune has no null literal, so this mapping is
      // unambiguous both ways. Only the LOOSE spellings (`!=`/`==`) map to
      // exists/absent: `x !== null`/`x === null` are strict comparisons
      // (they don't also match `undefined`, unlike the loose forms), which
      // is NOT the semantic `render-ts.ts` emits (`!= null`/`== null`), so
      // those must fall through and be refused below.
      if (op === '!=' && right.type === 'null') {
        return {
          $type: 'RosettaExistsExpression',
          argument: toRosetta(left),
          operator: 'exists'
        } as unknown as RosettaExpression;
      }
      if (op === '==' && right.type === 'null') {
        return {
          $type: 'RosettaAbsentExpression',
          argument: toRosetta(left),
          operator: 'absent'
        } as unknown as RosettaExpression;
      }

      if (op in COMPARISON_FROM_TS) {
        return {
          $type: 'ComparisonOperation',
          left: toRosetta(left),
          operator: COMPARISON_FROM_TS[op],
          right: toRosetta(right)
        } as unknown as RosettaExpression;
      }
      if (op in EQUALITY_FROM_TS) {
        return {
          $type: 'EqualityOperation',
          left: toRosetta(left),
          operator: EQUALITY_FROM_TS[op],
          right: toRosetta(right)
        } as unknown as RosettaExpression;
      }
      if (op in LOGICAL_FROM_TS) {
        return {
          $type: 'LogicalOperation',
          left: toRosetta(left),
          operator: LOGICAL_FROM_TS[op],
          right: toRosetta(right)
        } as unknown as RosettaExpression;
      }
      if (op in ARITHMETIC_FROM_TS) {
        return {
          $type: 'ArithmeticOperation',
          left: toRosetta(left),
          operator: ARITHMETIC_FROM_TS[op],
          right: toRosetta(right)
        } as unknown as RosettaExpression;
      }
      throw new OutOfSubset(`operator '${op}' is not supported`, node);
    }

    // Only `?.`-guarded access is accepted — plain `.` implies a different
    // (non-propagating) null semantic than Rune's optional path navigation.
    // Distinguishing field, confirmed by parsing both forms: `optional_chain`
    // is a present child node for `?.` and `null` for plain `.`.
    case 'member_expression': {
      if (!node.childForFieldName('optional_chain')) {
        throw new OutOfSubset('property access must use ?. — plain . has no Rune equivalent', node);
      }
      const object = field(node, 'object');
      const property = field(node, 'property');
      if (!isRuneValidId(property.text)) {
        throw new OutOfSubset(`"${property.text}" is not a valid Rune identifier for a feature reference`, property);
      }
      return {
        $type: 'RosettaFeatureCall',
        receiver: toRosetta(object),
        feature: { $refText: property.text }
      } as unknown as RosettaExpression;
    }

    case 'identifier': {
      // A TypeScript reserved word can still be lexed by tree-sitter as a
      // plain `identifier` token outside declaration position (e.g. `let`
      // as a comparison operand) even though it's not a valid TypeScript
      // identifier at the language level. renderTs already refuses to emit
      // a RosettaSymbolReference whose $refText collides with
      // TS_RESERVED_WORDS (see render-ts.ts) — refuse it here too, or the
      // TypeScript→Rune→TypeScript fixed point breaks: this text would
      // parse successfully but the resulting AST could never render back.
      if (!isRuneValidId(node.text) || TS_RESERVED_WORDS.has(node.text)) {
        throw new OutOfSubset(`"${node.text}" is not a valid Rune identifier`, node);
      }
      return {
        $type: 'RosettaSymbolReference',
        explicitArguments: false,
        rawArgs: [],
        symbol: { $refText: node.text }
      } as unknown as RosettaExpression;
    }

    case 'true':
    case 'false':
      return { $type: 'RosettaBooleanLiteral', value: node.type === 'true' } as unknown as RosettaExpression;

    case 'number':
      return numberNodeToRosetta(node.text, node);

    // tree-sitter always parses a leading `-` before a numeric literal as a
    // `unary_expression` wrapping a `number` node — never a single negative
    // `number` token (confirmed via an isolated grammar parse of `-1;`, see
    // task1 investigation report's "Root cause C"). `render-ts.ts` emits
    // exactly this text for a negative `RosettaIntLiteral`/`RosettaNumberLiteral`,
    // so this case must accept it back. Every other unary shape (negating an
    // identifier/call/member-expression, `!`, `~`, unary `+`, `typeof`, etc.)
    // has no Rune equivalent and is refused.
    case 'unary_expression': {
      const operator = field(node, 'operator');
      const argument = field(node, 'argument');
      if (operator.text !== '-' || argument.type !== 'number') {
        throw new OutOfSubset(
          "'unary_expression' is not supported (only negative numeric literals have a Rune equivalent)",
          node
        );
      }
      return numberNodeToRosetta('-' + argument.text, node);
    }

    case 'string': {
      // tree-sitter's `string` node's `.text` includes the surrounding
      // quotes verbatim (e.g. `"USD"`), but `RosettaStringLiteral.value`
      // (per packages/core/src/generated/ast.ts) holds the unquoted,
      // unescaped content. Only double-quoted strings are accepted —
      // matching `render-ts.ts`'s own `JSON.stringify`-based emission
      // convention (Rune's own string syntax and this lens's TS projection
      // are both double-quote based). A double-quoted TS string literal
      // (no template-literal features) is JSON-compatible syntax, so
      // `JSON.parse` both validates the quote style and correctly decodes
      // escape sequences in one step; anything that isn't double-quoted or
      // doesn't decode cleanly is refused rather than guessed at.
      if (!node.text.startsWith('"')) {
        throw new OutOfSubset('string literals must be double-quoted', node);
      }
      let value: string;
      try {
        value = JSON.parse(node.text) as string;
      } catch {
        throw new OutOfSubset(`string literal '${node.text}' could not be decoded`, node);
      }
      return { $type: 'RosettaStringLiteral', value } as unknown as RosettaExpression;
    }

    default:
      throw new OutOfSubset(`'${node.type}' is not supported`, node);
  }
}
