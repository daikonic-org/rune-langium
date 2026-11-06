// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, expect, it } from 'vitest';
import { preserveNodeMeasurements } from '../../src/components/layout-sync.js';

describe('layout measurement continuity', () => {
  it('keeps a measured node visible when an earlier position-only result arrives in the same frame', () => {
    const current = [{ id: 'Quote', type: 'data', position: { x: 0, y: 0 }, measured: { width: 240, height: 120 } }];
    const layout = [{ id: 'Quote', type: 'data', position: { x: 80, y: 40 } }];
    expect(preserveNodeMeasurements(current, layout)).toEqual([
      { ...layout[0], measured: { width: 240, height: 120 } }
    ]);
    expect(layout[0]).not.toHaveProperty('measured');
  });

  it('prefers newer dimensions and does not transfer measurements across node kinds or identities', () => {
    const old = [{ id: 'Quote', type: 'data', measured: { width: 240, height: 120 } }];
    expect(
      preserveNodeMeasurements(old, [{ id: 'Quote', type: 'data', measured: { width: 260 } }])[0]?.measured
    ).toEqual({ width: 260, height: 120 });
    expect(preserveNodeMeasurements(old, [{ id: 'Quote', type: 'function' }])[0]).not.toHaveProperty('measured');
    expect(preserveNodeMeasurements(old, [{ id: 'Trade', type: 'data' }])[0]).not.toHaveProperty('measured');
  });
});
