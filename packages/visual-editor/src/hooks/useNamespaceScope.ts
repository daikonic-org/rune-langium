// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { SegmentNode } from '../utils/namespace-tree.js';
import { namespaceTreeScope } from '../utils/namespace-tree-presentation.js';

/** Local navigation only: graph visibility, inclusion and declaration IDs are untouched. */
export function useNamespaceScope(
  roots: SegmentNode[],
  query: string,
  scrollRef: RefObject<HTMLDivElement | null>,
  setExpanded: Dispatch<SetStateAction<Set<string>>>
) {
  const [focusPath, setFocusPath] = useState<string | null>(null);
  const focusedRoots = useMemo(() => namespaceTreeScope(roots, focusPath), [roots, focusPath]);
  const activeFocus = focusedRoots.length ? focusPath : null;
  const scopedRoots = activeFocus === null ? roots : focusedRoots;
  const focusNamespace = useCallback(
    (path: string | null) => {
      setFocusPath(path);
      if (path !== null)
        setExpanded((prev) => new Set([...prev, ...namespaceTreeScope(roots, path).map((node) => node.fullPath)]));
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    },
    [roots, scrollRef, setExpanded]
  );
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [query, activeFocus, scrollRef]);
  return { activeFocus, scopedRoots, focusNamespace };
}
