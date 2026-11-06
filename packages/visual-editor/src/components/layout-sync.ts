// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/** Keep React Flow's measured dimensions when a layout result only replaces positions. */
export function preserveNodeMeasurements<
  N extends {
    id: string;
    type?: string;
    measured?: { width?: number; height?: number };
  }
>(current: readonly N[], next: readonly N[]): N[] {
  const previous = new Map(current.map((node) => [node.id, node]));
  return next.map((node) => {
    const old = previous.get(node.id);
    if (!old?.measured || old.type !== node.type) return node;
    return { ...node, measured: { ...old.measured, ...node.measured } };
  });
}

/**
 * Compare two React Flow layout snapshots and decide whether the next
 * computed layout should replace the current local node positions.
 *
 * A layout is considered different when the node set changes or when any
 * node's computed position moves beyond a tiny epsilon. This lets drag
 * positions survive unrelated data refreshes while still letting Dagre win
 * whenever a relayout actually occurred.
 */
export function shouldReplaceLayoutPositions(
  previousNodes: Array<{ id: string; position: { x: number; y: number } }>,
  nextNodes: Array<{ id: string; position: { x: number; y: number } }>
): boolean {
  if (previousNodes.length === 0) return false;
  if (previousNodes.length !== nextNodes.length) return true;

  const previousPositions = new Map(previousNodes.map((node) => [node.id, node.position]));
  for (const node of nextNodes) {
    const previousPosition = previousPositions.get(node.id);
    if (!previousPosition) return true;

    const deltaX = Math.abs(previousPosition.x - node.position.x);
    const deltaY = Math.abs(previousPosition.y - node.position.y);
    if (deltaX > 0.5 || deltaY > 0.5) return true;
  }

  return false;
}
