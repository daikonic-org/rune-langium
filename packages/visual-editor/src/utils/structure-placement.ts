// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

export interface CanvasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Nearest legal position on one parent canvas; peers keep a readable gutter. */
export function placeStructureBlock(
  desired: CanvasRect,
  previous: CanvasRect,
  peers: readonly CanvasRect[],
  availableWidth: number,
  mode: 'move' | 'resize',
  gap = 16
): CanvasRect {
  const bounded = (rect: CanvasRect): CanvasRect => ({
    ...rect,
    x: Math.max(0, Math.min(Math.max(0, availableWidth - rect.width), rect.x)),
    y: Math.max(8, rect.y)
  });
  const clear = (rect: CanvasRect) =>
    peers.every(
      (peer) =>
        rect.x + rect.width + gap <= peer.x ||
        peer.x + peer.width + gap <= rect.x ||
        rect.y + rect.height + gap <= peer.y ||
        peer.y + peer.height + gap <= rect.y
    );
  const target = bounded(desired);
  if (clear(target)) return target;
  if (mode === 'resize') {
    // Keep the far edge fixed, stopping the moving edge at the first peer.
    const right = target.x + target.width;
    const left = Math.max(
      target.x,
      ...peers
        .filter(
          (peer) => target.y < peer.y + peer.height + gap && target.y + target.height + gap > peer.y && peer.x < right
        )
        .map((peer) => peer.x + peer.width + gap)
    );
    const stopped = { ...target, x: left, width: right - left };
    return stopped.width >= Math.min(160, availableWidth) && clear(stopped) ? stopped : previous;
  }
  const candidates = [target, { ...target, x: previous.x }, { ...target, y: previous.y }, previous];
  for (const peer of peers) {
    candidates.push(
      { ...target, x: peer.x - target.width - gap },
      { ...target, x: peer.x + peer.width + gap },
      { ...target, y: peer.y - target.height - gap },
      { ...target, y: peer.y + peer.height + gap }
    );
  }
  return (
    candidates
      .map(bounded)
      .filter(clear)
      .sort((a, b) => Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y))[0] ??
    previous
  );
}
