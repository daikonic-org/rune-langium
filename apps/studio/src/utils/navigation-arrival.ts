// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { withInstrumentation } from '../services/instrumentation/core.js';

const arrivals = new WeakMap<HTMLElement, () => void>();

/** Briefly mark an indirect navigation destination; callers dispose on supersession/unmount. */
export const emphasizeNavigationArrival = withInstrumentation(
  function emphasizeNavigationArrival(element: HTMLElement): () => void {
    arrivals.get(element)?.();
    element.classList.remove('navigation-arrival');
    // Restart the same destination's CSS cue without replacing its DOM or moving content.
    void element.offsetWidth;
    element.classList.add('navigation-arrival');
    const cleanup = () => {
      if (arrivals.get(element) !== cleanup) return;
      clearTimeout(timer);
      element.classList.remove('navigation-arrival');
      arrivals.delete(element);
    };
    const timer = setTimeout(cleanup, 1000);
    arrivals.set(element, cleanup);
    return cleanup;
  },
  { op: 'emphasizeNavigationArrival' }
);
