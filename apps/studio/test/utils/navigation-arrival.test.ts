// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, describe, expect, it, vi } from 'vitest';
import { emphasizeNavigationArrival } from '../../src/utils/navigation-arrival.js';

afterEach(() => vi.useRealTimers());

describe('navigation arrival emphasis', () => {
  it('emphasizes an existing destination for one second without changing its content', () => {
    vi.useFakeTimers();
    const target = document.createElement('div');
    target.textContent = 'Existing destination';
    emphasizeNavigationArrival(target);
    expect(target).toHaveClass('navigation-arrival');
    expect(target.textContent).toBe('Existing destination');
    vi.advanceTimersByTime(1000);
    expect(target).not.toHaveClass('navigation-arrival');
  });

  it('restarts identical arrivals and prevents stale cleanup cancelling the new cue', () => {
    vi.useFakeTimers();
    const target = document.createElement('div');
    const cancelFirst = emphasizeNavigationArrival(target);
    vi.advanceTimersByTime(600);
    const cancelLatest = emphasizeNavigationArrival(target);
    cancelFirst();
    vi.advanceTimersByTime(400);
    expect(target).toHaveClass('navigation-arrival');
    cancelLatest();
    expect(target).not.toHaveClass('navigation-arrival');
    expect(vi.getTimerCount()).toBe(0);
  });
});
