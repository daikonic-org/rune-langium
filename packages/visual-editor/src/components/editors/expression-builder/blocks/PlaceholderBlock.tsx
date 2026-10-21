// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * PlaceholderBlock — renders dashed border placeholder with expected type hint.
 *
 * Accepts onActivate callback (wired to palette) and onDragNode for drop targets.
 *
 * @module
 */

import { useCallback, useRef, useState, type DragEvent } from 'react';
import type { ExpressionNode } from '../../../../schemas/expression-node-schema.js';
import { EXPRESSION_DRAG_TYPE } from '../../../../hooks/expression-drag.js';

export interface PlaceholderBlockProps {
  node: ExpressionNode;
  onActivate?: (nodeId: string) => void;
  onDragNode?: (draggedNodeId: string, targetNodeId: string) => void;
}

export function PlaceholderBlock({ node, onActivate, onDragNode }: PlaceholderBlockProps) {
  const n = node as Record<string, unknown>;
  const nodeId = n['id'] as string;
  const expectedType = n['expectedType'] as string | undefined;
  const [isDropTarget, setIsDropTarget] = useState(false);
  const enterCountRef = useRef(0);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onActivate?.(nodeId);
    },
    [onActivate, nodeId]
  );

  const handleDragOver = useCallback((e: DragEvent) => {
    if (e.dataTransfer.types.includes(EXPRESSION_DRAG_TYPE)) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
    }
  }, []);

  const handleDragEnter = useCallback((e: DragEvent) => {
    if (e.dataTransfer.types.includes(EXPRESSION_DRAG_TYPE)) {
      e.stopPropagation();
      enterCountRef.current++;
      setIsDropTarget(true);
    }
  }, []);

  const handleDragLeave = useCallback((_e: DragEvent) => {
    enterCountRef.current--;
    if (enterCountRef.current <= 0) {
      enterCountRef.current = 0;
      setIsDropTarget(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      enterCountRef.current = 0;
      setIsDropTarget(false);

      const draggedNodeId = e.dataTransfer.getData(EXPRESSION_DRAG_TYPE);
      if (!draggedNodeId || draggedNodeId === nodeId) return;

      onDragNode?.(draggedNodeId, nodeId);
    },
    [nodeId, onDragNode]
  );

  return (
    <button
      type="button"
      className={`inline-flex cursor-pointer items-center rounded border border-dashed px-2 py-0.5 text-xs transition-colors ${
        isDropTarget
          ? 'border-solid border-ring bg-accent text-accent-foreground'
          : 'border-(--color-expr-placeholder) text-(--color-expr-placeholder) bg-(--color-expr-placeholder-bg) hover:border-solid hover:opacity-80'
      }`}
      data-block="placeholder"
      data-drop-target={isDropTarget || undefined}
      onClick={handleClick}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      aria-label={expectedType ? `Add ${expectedType} expression` : 'Add expression'}
    >
      {expectedType ? `+ ${expectedType}` : '+ expression'}
    </button>
  );
}
