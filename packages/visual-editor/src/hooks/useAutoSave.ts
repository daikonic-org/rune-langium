// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Auto-save hook with configurable debounce delay.
 *
 * Commits the latest value after a period of inactivity. Uses a ref-based
 * approach to always flush the most recent value, avoiding stale closures.
 * Flushes pending value on unmount to prevent data loss.
 *
 * @example
 * ```tsx
 * const debouncedSave = useAutoSave((value: string) => {
 *   store.renameType(nodeId, value);
 * }, 500);
 *
 * <input onChange={(e) => debouncedSave(e.target.value)} />
 * ```
 */

import { useCallback, useEffect, useRef } from 'react';
import { useLatestRef } from './useLatestRef.js';
import { useEditorCommitRegistry } from './editor-commit-lifecycle.js';

/**
 * Returns a debounced callback that auto-saves the latest value after
 * `delay` milliseconds of inactivity. Flushes on unmount.
 *
 * @param onCommit - Callback invoked with the latest value on commit.
 * @param delay - Debounce delay in milliseconds (default 500).
 * @returns A debounced setter function.
 */
export function useAutoSave<T>(
  onCommit: (value: T) => void | boolean,
  delay = 500
): ((value: T) => void) & { flush(): void | boolean } {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef<T | undefined>(undefined);
  const pendingRef = useRef(false);
  // Keep the commit callback up to date without re-creating the debounced fn.
  const commitRef = useLatestRef(onCommit);

  const registry = useEditorCommitRegistry();
  const flush = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
    if (!pendingRef.current) return;
    pendingRef.current = false;
    const value = latestRef.current as T;
    const result = commitRef.current(value);
    if (result === false && !pendingRef.current) {
      latestRef.current = value;
      pendingRef.current = true;
    }
    return result;
  }, [commitRef]);
  const debouncedSet = useCallback(
    (value: T) => {
      latestRef.current = value;
      pendingRef.current = true;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        flush();
        if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
          window.dispatchEvent(new CustomEvent('__z2fAutoSaveCommit__', { detail: { timestamp: performance.now() } }));
        }
      }, delay);
    },
    [delay, flush]
  );
  useEffect(() => registry?.register(flush), [registry, flush]);
  useEffect(
    () => () => {
      flush();
    },
    [flush]
  );
  return Object.assign(debouncedSet, { flush });
}
