// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useNavigationArrival, type NavigationArrival } from '../../src/hooks/useNavigationArrival.js';

describe('navigation arrival timing and consumption', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('starts Graph, Structure, and Inspector together after settling, then ends once', () => {
    const { result } = renderHook(() => ({
      graph: useNavigationArrival(),
      structure: useNavigationArrival(),
      inspector: useNavigationArrival()
    }));
    const destinations = () => Object.values(result.current);
    act(() => destinations().forEach((cue) => cue.emphasizeArrival('test.Party#Data', 1)));
    act(() => vi.advanceTimersByTime(299));
    expect(destinations().map((cue) => cue.arrivalNodeId)).toEqual([null, null, null]);
    act(() => vi.advanceTimersByTime(1));
    expect(destinations().map((cue) => cue.arrivalNodeId)).toEqual(Array(3).fill('test.Party#Data'));
    act(() => vi.advanceTimersByTime(1000));
    expect(destinations().map((cue) => cue.arrivalNodeId)).toEqual([null, null, null]);
    act(() => vi.advanceTimersByTime(1000));
    expect(destinations().map((cue) => cue.arrivalNodeId)).toEqual([null, null, null]);
  });

  it('does not replay or extend a consumed arrival after rerendering', () => {
    const { result, rerender } = renderHook(() => useNavigationArrival());
    act(() => result.current.emphasizeArrival('test.Party#Data', 1));
    act(() => vi.advanceTimersByTime(800));
    rerender();
    act(() => result.current.emphasizeArrival('test.Party#Data', 1));
    act(() => vi.advanceTimersByTime(500));
    expect(result.current.arrivalNodeId).toBeNull();
    act(() => result.current.emphasizeArrival('test.Party#Data', 1));
    act(() => vi.advanceTimersByTime(300));
    expect(result.current.arrivalNodeId).toBeNull();
  });

  it('allows explicit repeat navigation with a new revision', () => {
    const { result } = renderHook(() => useNavigationArrival());
    act(() => result.current.emphasizeArrival('test.Party#Data', 1));
    act(() => vi.advanceTimersByTime(1300));
    act(() => result.current.emphasizeArrival('test.Party#Data', 2));
    act(() => vi.advanceTimersByTime(300));
    expect(result.current.arrivalNodeId).toBe('test.Party#Data');
  });

  it('cancels a superseded destination without consuming a cue that never started', () => {
    const consumed = { current: undefined as NavigationArrival | undefined };
    const { result } = renderHook(() => useNavigationArrival(consumed));
    act(() => result.current.emphasizeArrival('test.Party#Data', 1));
    act(() => vi.advanceTimersByTime(100));
    act(() => result.current.cancelArrival());
    expect(consumed.current).toBeUndefined();
    act(() => result.current.emphasizeArrival('test.Trade#Data', 2));
    act(() => vi.advanceTimersByTime(300));
    expect(result.current.arrivalNodeId).toBe('test.Trade#Data');
    expect(consumed.current).toEqual({ nodeId: 'test.Trade#Data', revision: 2 });
  });

  it('retains consumption across pane remounts when the owner keeps the receipt', () => {
    const consumed = { current: undefined as NavigationArrival | undefined };
    const first = renderHook(() => useNavigationArrival(consumed));
    act(() => first.result.current.emphasizeArrival('test.Party#Data', 1));
    act(() => vi.advanceTimersByTime(300));
    first.unmount();
    const second = renderHook(() => useNavigationArrival(consumed));
    act(() => second.result.current.emphasizeArrival('test.Party#Data', 1));
    act(() => vi.advanceTimersByTime(300));
    expect(second.result.current.arrivalNodeId).toBeNull();
  });
});
