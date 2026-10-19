// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { TypeGraphNode } from '../types.js';
import { enumPreviewRowCount } from '../utils/enum-preview.js';

export const DEFAULT_NODE_WIDTH = 220;
export const DEFAULT_NODE_HEIGHT = 120;

function parseDimension(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

export function estimateNodeHeight(node: TypeGraphNode): number {
  const data = node.data as Record<string, unknown>;
  const members = (data.attributes ?? data.enumValues ?? data.inputs ?? data.features ?? []) as unknown[];
  const headerHeight = 40;
  const memberHeight = 24;
  const padding = 16;
  const rowCount = node.type === 'enum' ? enumPreviewRowCount(members.length) : members.length;
  return Math.max(DEFAULT_NODE_HEIGHT, headerHeight + rowCount * memberHeight + padding);
}

export function getNodeWidth(node: TypeGraphNode): number {
  return (
    node.measured?.width ??
    parseDimension(node.width) ??
    parseDimension((node.style as { width?: unknown } | undefined)?.width) ??
    DEFAULT_NODE_WIDTH
  );
}

export function getNodeHeight(node: TypeGraphNode): number {
  return (
    node.measured?.height ??
    parseDimension(node.height) ??
    parseDimension((node.style as { height?: unknown } | undefined)?.height) ??
    estimateNodeHeight(node)
  );
}
