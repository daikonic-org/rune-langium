// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * BinaryBlock — renders binary operations (arithmetic, comparison, logic, etc.).
 *
 * Shows operator label between left/right child slots, color-coded by category.
 *
 * @module
 */

import type { ExpressionNode } from '../../../../schemas/expression-node-schema.js';

/** Map $type to color category CSS class. */
function categoryClass($type: string): string {
  switch ($type) {
    case 'ArithmeticOperation':
      return 'text-(--color-expr-arithmetic) bg-(--color-expr-arithmetic-bg)';
    case 'ComparisonOperation':
    case 'EqualityOperation':
    case 'RosettaContainsExpression':
    case 'RosettaDisjointExpression':
      return 'text-(--color-expr-comparison) bg-(--color-expr-comparison-bg)';
    case 'LogicalOperation':
      return 'text-(--color-expr-logic) bg-(--color-expr-logic-bg)';
    default:
      return 'text-(--color-expr-arithmetic) bg-(--color-expr-arithmetic-bg)';
  }
}

export interface BinaryBlockProps {
  node: ExpressionNode;
  renderChild: (child: ExpressionNode | undefined) => React.ReactNode;
}

export function BinaryBlock({ node, renderChild }: BinaryBlockProps) {
  const n = node as Record<string, unknown>;
  const operator = (n['operator'] as string) ?? '';
  const left = n['left'] as ExpressionNode | undefined;
  const right = n['right'] as ExpressionNode | undefined;
  const cardMod = n['cardMod'] as string | undefined;

  return (
    <span
      className={`inline-flex min-w-0 max-w-full flex-wrap items-baseline gap-1 rounded px-1 py-0.5 ${categoryClass(n['$type'] as string)}`}
      data-block="binary"
    >
      {renderChild(left)}
      <span className="font-mono text-xs font-semibold opacity-90">
        {cardMod ? `${operator} ${cardMod}` : operator}
      </span>
      {renderChild(right)}
    </span>
  );
}
