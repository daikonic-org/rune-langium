// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

export interface NavigationArrival {
  nodeId: string;
  revision: number;
}

/** Brief destination emphasis, independent of selection and camera auto-fitting. */
export function useNavigationArrival(consumedArrivalRef?: RefObject<NavigationArrival | undefined>) {
  const localConsumedArrivalRef = useRef<NavigationArrival | undefined>(undefined);
  const consumedArrival = consumedArrivalRef ?? localConsumedArrivalRef;
  const [arrivalNodeId, setArrivalNodeId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancelArrival = useCallback(() => {
    clearTimeout(timer.current);
    setArrivalNodeId(null);
  }, []);
  const emphasizeArrival = useCallback(
    (nodeId: string, revision?: number) => {
      if (
        revision !== undefined &&
        consumedArrival.current?.nodeId === nodeId &&
        consumedArrival.current.revision === revision
      )
        return;
      clearTimeout(timer.current);
      setArrivalNodeId(null);
      // Let the destination camera settle before starting the one-second cue.
      timer.current = setTimeout(() => {
        // Consume only once the cue starts, so cancelled or deferred arrivals can retry.
        if (revision !== undefined) consumedArrival.current = { nodeId, revision };
        setArrivalNodeId(nodeId);
        timer.current = setTimeout(() => setArrivalNodeId(null), 1000);
      }, 300);
    },
    [consumedArrival]
  );
  useEffect(() => () => clearTimeout(timer.current), []);
  return { arrivalNodeId, emphasizeArrival, cancelArrival };
}
