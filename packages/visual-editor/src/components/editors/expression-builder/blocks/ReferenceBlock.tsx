// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * ReferenceBlock — renders symbol references and implicit variables.
 *
 * @module
 */

import type { ReactNode } from 'react';
import { getChildren, type FunctionScope } from '../../../../store/expression-store.js';
import type { ExpressionNode } from '../../../../schemas/expression-node-schema.js';

export interface ReferenceBlockProps {
  node: ExpressionNode;
  scope?: FunctionScope;
  renderChild?: (child: ExpressionNode | undefined) => ReactNode;
  onEdit?: (nodeId: string) => void;
}

export function ReferenceBlock({ node, scope, renderChild, onEdit }: ReferenceBlockProps) {
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
  const reference = onEdit ? (
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
  ) : (
    <span className={className} data-block="reference">
      {content}
    </span>
  );
  const args = $type === 'RosettaSymbolReference' ? getChildren(node) : [];
  if (args.length === 0 && n['explicitArguments'] !== true) return reference;
  const names = scope?.references?.find((entry) => entry.kind === 'callable' && entry.name === name)?.argumentNames;
  return (
    <span className="inline-flex min-w-0 max-w-full flex-wrap items-baseline gap-1" data-block="call">
      {reference}
      <span aria-hidden="true" className="font-mono text-xs">
        (
      </span>
      {args.map((argument, index) => {
        const label = names?.[index] ?? `argument ${index + 1}`;
        return (
          <span
            key={typeof argument.id === 'string' ? argument.id : index}
            className="inline-flex min-w-0 max-w-full items-baseline gap-1"
          >
            {index > 0 && (
              <span aria-hidden="true" className="font-mono text-xs opacity-50">
                ,
              </span>
            )}
            <span
              role="group"
              aria-label={`${name} argument ${names?.[index] ?? index + 1}`}
              className="inline-flex min-w-0 max-w-full flex-wrap items-baseline gap-1"
            >
              <span className="font-mono text-2xs text-muted-foreground">{label}:</span>
              {renderChild?.(argument)}
            </span>
          </span>
        );
      })}
      <span aria-hidden="true" className="font-mono text-xs">
        )
      </span>
    </span>
  );
}
