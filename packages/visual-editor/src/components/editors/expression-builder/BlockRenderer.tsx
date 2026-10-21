// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * BlockRenderer — recursive dispatch component for expression tree rendering.
 *
 * Reads the node's `$type` and delegates to the appropriate block component.
 * Wraps each block with selection highlighting and `data-node-id` for hit-testing.
 *
 * @module
 */

import { memo, useCallback, useState, type DragEvent } from 'react';
import { EXPRESSION_DRAG_TYPE } from '../../../hooks/useDragDrop.js';
import type { ExpressionNode } from '../../../schemas/expression-node-schema.js';
import { BinaryBlock } from './blocks/BinaryBlock.js';
import { UnaryBlock } from './blocks/UnaryBlock.js';
import { FeatureCallBlock } from './blocks/FeatureCallBlock.js';
import { ConditionalBlock } from './blocks/ConditionalBlock.js';
import { SwitchBlock } from './blocks/SwitchBlock.js';
import { LambdaBlock } from './blocks/LambdaBlock.js';
import { ConstructorBlock } from './blocks/ConstructorBlock.js';
import { LiteralBlock } from './blocks/LiteralBlock.js';
import { ReferenceBlock } from './blocks/ReferenceBlock.js';
import { ListBlock } from './blocks/ListBlock.js';
import { PlaceholderBlock } from './blocks/PlaceholderBlock.js';
import { UnsupportedBlock } from './blocks/UnsupportedBlock.js';

export interface BlockRendererProps {
  node: ExpressionNode;
  selectedNodeId?: string | null;
  onSelect?: (nodeId: string) => void;
  onEditReference?: (nodeId: string) => void;
  onActivatePlaceholder?: (nodeId: string) => void;
  onDragNode?: (draggedNodeId: string, targetNodeId: string) => void;
  depth?: number;
}

/** Set of binary operation $types. */
const BINARY_TYPES = new Set([
  'ArithmeticOperation',
  'ComparisonOperation',
  'EqualityOperation',
  'LogicalOperation',
  'RosettaContainsExpression',
  'RosettaDisjointExpression',
  'DefaultOperation',
  'JoinOperation'
]);

/** Set of unary postfix $types. */
const UNARY_TYPES = new Set([
  'RosettaExistsExpression',
  'RosettaAbsentExpression',
  'RosettaOnlyElement',
  'RosettaOnlyExistsExpression',
  'RosettaCountOperation',
  'FlattenOperation',
  'DistinctOperation',
  'ReverseOperation',
  'FirstOperation',
  'LastOperation',
  'SumOperation',
  'OneOfOperation',
  'ToStringOperation',
  'ToNumberOperation',
  'ToIntOperation',
  'ToTimeOperation',
  'ToEnumOperation',
  'ToDateOperation',
  'ToDateTimeOperation',
  'ToZonedDateTimeOperation',
  'AsKeyOperation',
  'WithMetaOperation'
]);

/** Set of lambda operation $types. */
const LAMBDA_TYPES = new Set([
  'FilterOperation',
  'MapOperation',
  'ReduceOperation',
  'SortOperation',
  'MinOperation',
  'MaxOperation',
  'ThenOperation'
]);

/** Depth threshold for collapsible sub-expressions. */
const COLLAPSE_THRESHOLD = 3;

/** Leaf node types that shouldn't be collapsible. */
const LEAF_TYPES = new Set([
  'Placeholder',
  'Unsupported',
  'RosettaBooleanLiteral',
  'RosettaIntLiteral',
  'RosettaNumberLiteral',
  'RosettaStringLiteral',
  'RosettaSymbolReference',
  'RosettaImplicitVariable',
  'RosettaSuperCall'
]);

/** Access typed fields from ExpressionNode (which may have index signatures). */
function nodeId(node: ExpressionNode): string {
  return (node as Record<string, unknown>)['id'] as string;
}
function nodeType(node: ExpressionNode): string {
  return (node as Record<string, unknown>)['$type'] as string;
}

function BlockRendererInner({
  node,
  selectedNodeId,
  onSelect,
  onActivatePlaceholder,
  onEditReference,
  onDragNode,
  depth = 0
}: BlockRendererProps) {
  const id = nodeId(node);
  const isSelected = id === selectedNodeId;
  const $type = nodeType(node);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onSelect?.(id);
    },
    [onSelect, id]
  );

  const renderChild = useCallback(
    (child: ExpressionNode | undefined) => {
      if (!child) return null;
      return (
        <span role="group" className="contents">
          <BlockRenderer
            node={child}
            selectedNodeId={selectedNodeId}
            onSelect={onSelect}
            onEditReference={onEditReference}
            onActivatePlaceholder={onActivatePlaceholder}
            onDragNode={onDragNode}
            depth={depth + 1}
          />
        </span>
      );
    },
    [selectedNodeId, onSelect, onActivatePlaceholder, onEditReference, onDragNode, depth]
  );

  let content: React.ReactNode;

  if (BINARY_TYPES.has($type)) {
    content = <BinaryBlock node={node} renderChild={renderChild} />;
  } else if (UNARY_TYPES.has($type)) {
    content = <UnaryBlock node={node} renderChild={renderChild} />;
  } else if ($type === 'RosettaFeatureCall' || $type === 'RosettaDeepFeatureCall') {
    content = <FeatureCallBlock node={node} renderChild={renderChild} />;
  } else if ($type === 'RosettaConditionalExpression') {
    content = <ConditionalBlock node={node} renderChild={renderChild} />;
  } else if ($type === 'SwitchOperation') {
    content = <SwitchBlock node={node} renderChild={renderChild} />;
  } else if (LAMBDA_TYPES.has($type)) {
    content = <LambdaBlock node={node} renderChild={renderChild} />;
  } else if ($type === 'RosettaConstructorExpression') {
    content = <ConstructorBlock node={node} renderChild={renderChild} />;
  } else if (
    $type === 'RosettaBooleanLiteral' ||
    $type === 'RosettaIntLiteral' ||
    $type === 'RosettaNumberLiteral' ||
    $type === 'RosettaStringLiteral'
  ) {
    content = <LiteralBlock node={node} />;
  } else if ($type === 'RosettaSymbolReference' || $type === 'RosettaImplicitVariable') {
    content = <ReferenceBlock node={node} onEdit={onEditReference} />;
  } else if ($type === 'ListLiteral') {
    content = <ListBlock node={node} renderChild={renderChild} />;
  } else if ($type === 'RosettaSuperCall') {
    content = <ReferenceBlock node={node} onEdit={onEditReference} />;
  } else if ($type === 'ChoiceOperation') {
    content = <UnaryBlock node={node} renderChild={renderChild} />;
  } else if ($type === 'Placeholder') {
    content = <PlaceholderBlock node={node} onActivate={onActivatePlaceholder} onDragNode={onDragNode} />;
  } else if ($type === 'Unsupported') {
    content = <UnsupportedBlock node={node} />;
  } else {
    content = <UnsupportedBlock node={node} />;
  }

  const isDraggable = $type !== 'Placeholder' && $type !== 'Unsupported';
  const isCollapsible = depth >= COLLAPSE_THRESHOLD && !LEAF_TYPES.has($type);
  const [collapsed, setCollapsed] = useState(false);

  const handleDragStart = useCallback(
    (e: DragEvent) => {
      e.stopPropagation();
      e.dataTransfer.setData(EXPRESSION_DRAG_TYPE, id);
      e.dataTransfer.effectAllowed = 'move';
    },
    [id]
  );

  const handleToggleCollapse = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsed((prev) => !prev);
  }, []);

  return (
    <div
      className={`expr-block inline-flex items-baseline gap-1 rounded px-1 py-0.5 transition-shadow ${
        isSelected ? 'ring-2 ring-ring' : ''
      }`}
      data-node-id={id}
      data-node-type={$type}
      data-depth={depth}
      data-collapsed={collapsed || undefined}
      onClick={handleClick}
      draggable={isDraggable}
      onDragStart={isDraggable ? handleDragStart : undefined}
      role="treeitem"
      tabIndex={0}
      aria-selected={isSelected}
      aria-expanded={isCollapsible ? !collapsed : undefined}
    >
      {isCollapsible && collapsed ? (
        <button
          type="button"
          className="inline-flex items-center gap-0.5 rounded bg-muted px-1 py-0.5 text-3xs text-muted-foreground hover:bg-accent"
          onClick={handleToggleCollapse}
          data-testid="expand-block"
          aria-label="Expand sub-expression"
        >
          <span>{'▸'}</span>
          <span className="font-mono">{$type.replace(/^Rosetta/, '').replace(/Operation$/, '')}</span>
          <span>{'…'}</span>
        </button>
      ) : (
        <>
          {isCollapsible && (
            <button
              type="button"
              className="inline-flex items-center rounded text-3xs text-muted-foreground opacity-50 hover:opacity-100"
              onClick={handleToggleCollapse}
              data-testid="collapse-block"
              aria-label="Collapse sub-expression"
            >
              {'▾'}
            </button>
          )}
          {content}
        </>
      )}
    </div>
  );
}

export const BlockRenderer = memo(BlockRendererInner);
BlockRenderer.displayName = 'BlockRenderer';
