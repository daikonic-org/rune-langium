// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { useCallback, useEffect, useRef, useState } from 'react';

/** Brief destination emphasis, independent of selection and camera auto-fitting. */
export function useNavigationArrival() {
  const [arrivalNodeId, setArrivalNodeId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancelArrival = useCallback(() => {
    clearTimeout(timer.current);
    setArrivalNodeId(null);
  }, []);
  const emphasizeArrival = useCallback((nodeId: string) => {
    clearTimeout(timer.current);
    setArrivalNodeId(null);
    // Let the destination camera settle before starting the one-second cue.
    timer.current = setTimeout(() => {
      setArrivalNodeId(nodeId);
      timer.current = setTimeout(() => setArrivalNodeId(null), 1000);
    }, 300);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return { arrivalNodeId, emphasizeArrival, cancelArrival };
}
