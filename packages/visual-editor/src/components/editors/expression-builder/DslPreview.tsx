// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * DslPreview — read-only panel showing live DSL text.
 *
 * Shows the serialized DSL from expressionNodeToDslPreview().
 *
 * @module
 */

import { useMemo } from 'react';
import type { ExpressionNode } from '../../../schemas/expression-node-schema.js';
import { expressionNodeToDslPreview } from '../../../adapters/expression-node-to-dsl.js';

export interface DslPreviewProps {
  tree: ExpressionNode;
  collapsed?: boolean;
}

export function DslPreview({ tree, collapsed }: DslPreviewProps) {
  const dslText = useMemo(() => {
    try {
      return expressionNodeToDslPreview(tree);
    } catch {
      return '(unable to serialize)';
    }
  }, [tree]);

  if (collapsed) return null;

  return (
    <div className="rounded border border-border/50 bg-background/80 p-2" data-testid="dsl-preview">
      <div className="mb-1 text-3xs font-medium text-muted-foreground">DSL Preview</div>
      <pre className="whitespace-pre-wrap font-mono text-xs text-foreground/80">{dslText}</pre>
    </div>
  );
}
