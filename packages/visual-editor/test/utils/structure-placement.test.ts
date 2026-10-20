// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, expect, it } from 'vitest';
import { placeStructureBlock } from '../../src/utils/structure-placement.js';

describe('parent canvas collision placement', () => {
  const previous = { x: 240, y: 8, width: 200, height: 100 };
  const peer = { x: 240, y: 180, width: 200, height: 100 };
  it('slides a dragged card along a peer while retaining the gutter', () => {
    expect(placeStructureBlock({ ...previous, y: 120 }, previous, [peer], 600, 'move')).toEqual({ ...previous, y: 64 });
  });
  it('contains movement horizontally while clearing a peer', () => {
    const placed = placeStructureBlock({ ...previous, x: 900, y: 200 }, previous, [peer], 600, 'move');
    expect(placed.x + placed.width).toBeLessThanOrEqual(600);
    expect(placed.y).toBeGreaterThanOrEqual(peer.y + peer.height + 16);
  });
  it('stops a left resize at a same-level peer without moving the right edge', () => {
    const leftPeer = { x: 0, y: 8, width: 200, height: 100 };
    const placed = placeStructureBlock({ ...previous, x: 100, width: 340 }, previous, [leftPeer], 600, 'resize');
    expect(placed).toEqual({ ...previous, x: 216, width: 224 });
    expect(placed.x + placed.width).toBe(previous.x + previous.width);
  });
  it('allows a move that clears a peer without unnecessarily snapping', () => {
    const desired = { ...previous, x: 100, y: 60 };
    expect(placeStructureBlock(desired, previous, [peer], 600, 'move')).toEqual(desired);
  });
});
