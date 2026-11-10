// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Rune → TypeScript projection over subset `S` (see ../subset.ts).
 *
 * Independent of `expr/transpiler.ts` on purpose: that module's per-category
 * functions all require an `ExpressionTranspilerContext` (selfName, emitMode,
 * conditionName) built for emitting Zod-validator predicates inside a
 * generated class — this projects a bare expression tree with no host
 * condition at all. See the plan's "Deviations From the Spec" note.
 *
 * Returns `null` for any node outside `S` — never an approximate rendering.
 */
import type { RosettaExpression } from '@rune-langium/core';
import { TS_RESERVED_WORDS } from '../reserved-words.js';
import { isInSubsetS } from '../subset.js';
import { renderTypeScriptNumberLiteral } from '../../expr/number-literal.js';

type AnyNode = RosettaExpression & Record<string, unknown>;

const COMPARISON_TS: Record<string, string> = { '<': '<', '<=': '<=', '>': '>', '>=': '>=' };
const EQUALITY_TS: Record<string, string> = { '=': '===', '<>': '!==' };
const LOGICAL_TS: Record<string, string> = { and: '&&', or: '||' };
const ARITHMETIC_TS: Record<string, string> = { '+': '+', '-': '-', '*': '*', '/': '/' };

/**
 * JS/TS binary-operator precedence tier for the binary/comparison-shaped $types
 * this file emits, from loosest (1) to tightest (6). Returns `null` for anything
 * else (literals, symbol references, feature calls) since those are never the
 * PARENT in this table, only ever a possible child.
 *
 * RosettaExistsExpression/RosettaAbsentExpression share EqualityOperation's tier
 * (3): they render via `!= null`/`== null` (loose equality), which per the real
 * ECMAScript spec sits at the SAME precedence as `===`/`!==` (both are "Equality
 * operators", looser than relational `<`/`>` and tighter than logical `&&`/`||`).
 * Without a real tier here they were treated as atomic (`default: return null`),
 * which was wrong as a PARENT's child: `(currency exists) + 1` rendered
 * unparenthesized as `currency != null + 1`, which real TS parses as
 * `currency != (null + 1)` — wrong grouping, breaking round-trip.
 */
function precedenceTier(kind: string, operator: unknown): number | null {
  switch (kind) {
    case 'LogicalOperation':
      return operator === 'or' ? 1 : 2; // 'and'
    case 'EqualityOperation':
      return 3;
    case 'RosettaExistsExpression':
    case 'RosettaAbsentExpression':
      return 3;
    case 'ComparisonOperation':
      return 4;
    case 'ArithmeticOperation':
      return operator === '+' || operator === '-' ? 5 : 6; // '*' / '/'
    default:
      return null;
  }
}

/**
 * Render `child` under a binary parent at `parentTier`, on `side`, adding
 * parens only when required to preserve TS semantics/grouping: when `child`
 * binds looser than `parentTier`, or when it binds at the same tier but sits
 * on the right (these operators are all left-associative, so same-tier-right
 * nesting changes meaning, e.g. `a - (b - c)` vs `a - b - c`).
 */
function r(child: RosettaExpression, parentTier: number, side: 'left' | 'right'): string {
  const node = child as AnyNode;
  const text = renderTs(child);
  if (text === null) throw new UnsupportedInChild();
  const childTier = precedenceTier(node.$type, node['operator']);
  if (childTier === null) return text; // atomic — never needs parens here
  const needsParens = childTier < parentTier || (childTier === parentTier && side === 'right');
  return needsParens ? `(${text})` : text;
}

/**
 * Render `child`, unconditionally parenthesizing whenever it is itself a
 * binary/logical node. Used only for `RosettaFeatureCall`'s receiver: member
 * access (`?.`) binds tighter than every tier in `precedenceTier`, so the
 * receiver always needs parens if it's binary/logical, regardless of tier.
 */
function rTight(child: RosettaExpression): string {
  const node = child as AnyNode;
  const text = renderTs(child);
  if (text === null) throw new UnsupportedInChild();
  const needsParens =
    node.$type === 'LogicalOperation' ||
    node.$type === 'ComparisonOperation' ||
    node.$type === 'EqualityOperation' ||
    node.$type === 'ArithmeticOperation';
  return needsParens ? `(${text})` : text;
}

/** Internal signal: a child was outside `S` — caught by `renderTs` to return `null`. */
class UnsupportedInChild extends Error {}

export function renderTs(node: RosettaExpression): string | null {
  try {
    return dispatch(node as AnyNode);
  } catch (e) {
    if (e instanceof UnsupportedInChild) return null;
    throw e;
  }
}

function dispatch(node: AnyNode): string {
  if (!isInSubsetS(node)) throw new UnsupportedInChild();

  switch (node.$type) {
    case 'RosettaBooleanLiteral':
      return node['value'] ? 'true' : 'false';
    case 'RosettaIntLiteral':
    case 'RosettaNumberLiteral': {
      const text = String(node['value']);
      // A leading '+' is real, meaningful Rune AST data (Rune's BigDecimal
      // grammar preserves it verbatim in RosettaNumberLiteral.value; only
      // reachable there — RosettaIntLiteral's bigint value never
      // stringifies with a leading '+'). TypeScript has no syntax that
      // round-trips it: "+1.5" parses as a unary '+' expression, which
      // parseTs refuses (only unary '-' has a Rune equivalent). Stripping
      // it (the prior approach) silently mutated the underlying Rune AST
      // on a no-op lens open+close (no edit) — a real
      // TypeScript→Rune→TypeScript tree-equivalence loss, not just
      // cosmetic. Refuse rather than silently drop real AST data with no
      // honest encoding available.
      if (text.startsWith('+') || renderTypeScriptNumberLiteral(text) !== text) throw new UnsupportedInChild();
      return text;
    }
    case 'RosettaStringLiteral':
      return JSON.stringify(String(node['value']));
    case 'RosettaSymbolReference': {
      const symbol = node['symbol'] as { $refText?: string } | undefined;
      if (node['explicitArguments']) throw new UnsupportedInChild(); // function calls (any arity) are out of S for Phase 1
      if (!symbol?.$refText) throw new UnsupportedInChild();
      // A qualified (dotted) $refText (Rune's QualifiedName cross-ref grammar)
      // is not a single valid TS identifier: it would render as TS member
      // access, which parse-ts.ts correctly refuses without the `?.` idiom.
      // The `^`-prefix check below is defensive (guards hand-constructed AST
      // nodes) — Langium's convertID already strips a real `^`-escape before
      // $refText is populated (see render-expression.ts's escapeId()), so
      // $refText from real parsing never contains a literal `^`. That means a
      // stripped $refText can silently collide with a *TS* reserved word even
      // though it was never a *Rune* reserved word — refuse those too, since
      // emitting them verbatim (e.g. `class`) is a TS SyntaxError, not a valid
      // identifier. Refuse rather than guess at an encoding.
      if (symbol.$refText.includes('.') || symbol.$refText.startsWith('^') || TS_RESERVED_WORDS.has(symbol.$refText)) {
        throw new UnsupportedInChild();
      }
      return symbol.$refText;
    }
    case 'RosettaFeatureCall': {
      const receiver = rTight(node['receiver']);
      const feature = node['feature'] as { $refText?: string } | undefined;
      if (!feature?.$refText) throw new UnsupportedInChild();
      return `${receiver}?.${feature.$refText}`;
    }
    case 'RosettaExistsExpression': {
      // 'single'/'multiple' exists have no honest TS equivalent (they check
      // cardinality, not just presence) — refuse rather than silently drop
      // the modifier and change the semantics.
      if (node['modifier']) throw new UnsupportedInChild();
      // Argument-less exists (the grammar's "without left" form, used as
      // the RHS of a then-chain) has no receiver text to render — refuse
      // rather than let `node['argument']` be undefined and crash later.
      const argumentNode = node['argument'];
      if (!argumentNode) throw new UnsupportedInChild();
      const argument = r(argumentNode, 3, 'left');
      return `${argument} != null`;
    }
    case 'RosettaAbsentExpression': {
      // RosettaAbsentExpression has no modifier field (only 'is absent', no
      // single/multiple variant) — only the argument-less case applies.
      const argumentNode = node['argument'];
      if (!argumentNode) throw new UnsupportedInChild();
      const argument = r(argumentNode, 3, 'left');
      return `${argument} == null`;
    }
    case 'ArithmeticOperation': {
      const opKey = node['operator'] as string;
      const op = ARITHMETIC_TS[opKey];
      if (op === undefined) throw new UnsupportedInChild();
      const tier = precedenceTier('ArithmeticOperation', opKey)!;
      const left = r(node['left'], tier, 'left');
      const right = r(node['right'], tier, 'right');
      return `${left} ${op} ${right}`;
    }
    case 'ComparisonOperation': {
      if (node['cardMod']) throw new UnsupportedInChild(); // 'all'/'any' quantified comparisons have no TS equivalent
      const opKey = node['operator'] as string;
      const op = COMPARISON_TS[opKey];
      if (op === undefined) throw new UnsupportedInChild();
      const tier = precedenceTier('ComparisonOperation', opKey)!;
      const left = r(node['left'] as RosettaExpression, tier, 'left');
      const right = r(node['right'], tier, 'right');
      return `${left} ${op} ${right}`;
    }
    case 'EqualityOperation': {
      if (node['cardMod']) throw new UnsupportedInChild(); // 'all'/'any' quantified comparisons have no TS equivalent
      const opKey = node['operator'] as string;
      const op = EQUALITY_TS[opKey];
      if (op === undefined) throw new UnsupportedInChild();
      const tier = precedenceTier('EqualityOperation', opKey)!;
      const left = r(node['left'] as RosettaExpression, tier, 'left');
      const right = r(node['right'], tier, 'right');
      return `${left} ${op} ${right}`;
    }
    case 'LogicalOperation': {
      const opKey = node['operator'] as string;
      const op = LOGICAL_TS[opKey];
      if (op === undefined) throw new UnsupportedInChild();
      const tier = precedenceTier('LogicalOperation', opKey)!;
      const left = r(node['left'], tier, 'left');
      const right = r(node['right'], tier, 'right');
      return `${left} ${op} ${right}`;
    }
    default:
      throw new UnsupportedInChild();
  }
}
