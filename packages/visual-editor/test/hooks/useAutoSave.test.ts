// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Unit tests for useAutoSave hook (T045).
 *
 * Covers:
 * - Debounce timing (delayed commit)
 * - Flush-on-unmount
 * - Rapid successive value changes (only last committed)
 * - No commit when unmounted before delay
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutoSave } from '../../src/hooks/useAutoSave.js';

describe('useAutoSave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not commit immediately — waits for delay', () => {
    const onCommit = vi.fn();

    const { result } = renderHook(() => useAutoSave(onCommit, 300));

    act(() => {
      result.current('value-1');
    });

    // Not yet committed
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('commits after the configured delay', () => {
    const onCommit = vi.fn();

    const { result } = renderHook(() => useAutoSave(onCommit, 300));

    act(() => {
      result.current('value-1');
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith('value-1');
  });

  it('resets timer on rapid successive calls — commits only last value', () => {
    const onCommit = vi.fn();

    const { result } = renderHook(() => useAutoSave(onCommit, 300));

    act(() => {
      result.current('a');
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    act(() => {
      result.current('b');
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    act(() => {
      result.current('c');
    });

    // Wait full delay
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith('c');
  });

  it('flushes pending value on unmount', () => {
    const onCommit = vi.fn();

    const { result, unmount } = renderHook(() => useAutoSave(onCommit, 500));

    act(() => {
      result.current('pending');
    });

    // Unmount before timer
    unmount();

    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith('pending');
  });

  it('does not commit on unmount when nothing is pending', () => {
    const onCommit = vi.fn();

    const { unmount } = renderHook(() => useAutoSave(onCommit, 500));

    unmount();

    expect(onCommit).not.toHaveBeenCalled();
  });

  it('uses default delay of 500ms', () => {
    const onCommit = vi.fn();

    const { result } = renderHook(() => useAutoSave(onCommit));

    act(() => {
      result.current('data');
    });

    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(onCommit).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith('data');
  });

  it('does not double-commit if timer fires and then unmount', () => {
    const onCommit = vi.fn();

    const { result, unmount } = renderHook(() => useAutoSave(onCommit, 200));

    act(() => {
      result.current('value');
    });

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(onCommit).toHaveBeenCalledOnce();

    // Unmount after timer already fired — should not commit again
    unmount();

    expect(onCommit).toHaveBeenCalledOnce();
  });

  it('explicitly flushes the latest pending value once and cancels its timer', () => {
    const commit = vi.fn();
    const hook = renderHook(() => useAutoSave(commit));
    act(() => {
      hook.result.current('first');
      hook.result.current('latest');
      hook.result.current.flush();
    });
    act(() => vi.advanceTimersByTime(1000));
    hook.unmount();
    expect(commit).toHaveBeenCalledExactlyOnceWith('latest');
  });
});
