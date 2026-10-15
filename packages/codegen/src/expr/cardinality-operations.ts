// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Cardinality-sensitive expression operations.
 *
 * The Java reference maps binary comparisons to `areEqual`/`greaterThan`
 * etc. with CardinalityOperator (ALL/ANY), and maps `single exists` and
 * `multiple exists` to the corresponding runtime predicates.  Keep this
 * logic separate from the expression dispatcher so the dispatcher can share
 * it between conditions and nested expressions.
 */
import {
  isEqualityOperation,
  isListLiteral,
  isRosettaExistsExpression,
  type RosettaExpression
} from '@rune-langium/core';
import { expressionIsMany } from './navigation.js';
import { primitiveElementKind } from './scalar-operators.js';
import { methodEqualityPredicate, quantifiedEqualityBody } from './value-equality.js';
import type { ExpressionTranspilerContext } from './transpiler.js';

type Render = (expr: RosettaExpression, ctx: ExpressionTranspilerContext) => string;

/** Handle `all`/`any` comparisons and `single`/`multiple exists`. */
export function renderCardinalityOperation(
  expr: RosettaExpression,
  ctx: ExpressionTranspilerContext,
  render: Render
): string | undefined {
  if (isRosettaExistsExpression(expr) && expr.modifier) {
    const value = expr.argument ? render(expr.argument, ctx) : ctx.selfName;
    const mode = expr.modifier === 'single' ? '=== 1' : '> 1';
    // Java's singleExists/multipleExists operate on a multi-valued mapper.
    return `((__exists) => Array.isArray(__exists) ? __exists.length ${mode} : ${expr.modifier === 'single' ? '__exists != null' : 'false'})(${value})`;
  }

  const binary = isEqualityOperation(expr) ? expr : undefined;
  if (!binary) return undefined;
  const empty = (node: RosettaExpression | undefined) => isListLiteral(node) && node.elements.length === 0;
  // The projection's shared presence renderer owns plain comparisons with empty.
  if (ctx.projection && !binary.cardMod && (empty(binary.left) || empty(binary.right))) return undefined;
  const needsCollectionSemantics = (node: RosettaExpression | undefined): boolean => {
    if (!node) return false;
    if (expressionIsMany(node)) return true;
    if (node.$type === 'RosettaSymbolReference') {
      const name = node.symbol.$refText ?? '';
      const type = ctx.attributeTypes.get(name) ?? '';
      return type.includes('[]');
    }
    return false;
  };
  if (!binary.cardMod && !needsCollectionSemantics(binary.left) && !needsCollectionSemantics(binary.right))
    return undefined;

  const left = binary.left ? render(binary.left, ctx) : ctx.selfName;
  const right = render(binary.right, ctx);
  const quantifier = binary.cardMod ?? (binary.operator === '<>' ? 'any' : 'all');
  const kind = primitiveElementKind(binary.left);
  if (ctx.projection) {
    const unequal = binary.operator === '<>';
    const primitive = kind && ['number', 'string', 'boolean'].includes(kind);
    const equal = primitive ? 'a === b' : methodEqualityPredicate('a', 'b');
    const compare = unequal ? `!(${equal})` : `(${equal})`;
    return `((left, right) => { const unequal = ${unequal}; ${quantifiedEqualityBody(compare, false, String(quantifier === 'all'))} })(${left}, ${right})`;
  }
  if (kind && kind === primitiveElementKind(binary.right) && ['number', 'string', 'boolean'].includes(kind)) {
    const ts = ctx.emitMode.startsWith('ts-');
    const equal = kind === 'number' ? '(a === b || (Number.isNaN(a) && Number.isNaN(b)))' : '(a === b)';
    const comparison = binary.operator === '<>' ? `!${equal}` : equal;
    const parameters = ts ? '(left: unknown, right: unknown)' : '(left, right)';
    return `(${parameters} => { const unequal = ${binary.operator === '<>'}; ${quantifiedEqualityBody(comparison, ts, String(quantifier === 'all'))} })(${left}, ${right})`;
  }
  return `rune.equals(${left}, ${right}, ${JSON.stringify(quantifier)}${binary.operator === '<>' ? ', true' : ''})`;
}
