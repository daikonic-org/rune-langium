// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * ReferenceBlock — renders symbol references and implicit variables.
 *
 * @module
 */

import type { ExpressionNode } from '../../../../schemas/expression-node-schema.js';

export interface ReferenceBlockProps {
  node: ExpressionNode;
  onEdit?: (nodeId: string) => void;
}

export function ReferenceBlock({ node, onEdit }: ReferenceBlockProps) {
  const n = node as Record<string, unknown>;
  const $type = n['$type'] as string;

  let name: string;
  if ($type === 'RosettaImplicitVariable') {
    name = (n['name'] as string) ?? 'item';
  } else if ($type === 'RosettaSuperCall') {
    name = (n['name'] as string) ?? 'super';
  } else {
    name = (n['symbol'] as string) ?? '?';
  }

  const content = (
    <>
      <span className="font-medium">{name}</span>
      {$type === 'RosettaImplicitVariable' && <span className="text-3xs opacity-50">implicit</span>}
    </>
  );
  const className =
    'inline-flex items-baseline gap-1 rounded px-1 py-0.5 font-mono text-xs text-(--color-expr-reference) bg-(--color-expr-reference-bg)';
  if (onEdit) {
    return (
      <button
        type="button"
        className={`${className} cursor-pointer hover:underline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2`}
        data-block="reference"
        aria-label={`Edit reference ${name}`}
        onClick={(event) => {
          event.stopPropagation();
          onEdit(n['id'] as string);
        }}
      >
        {content}
      </button>
    );
  }

  return (
    <span className={className} data-block="reference">
      {content}
    </span>
  );
}
