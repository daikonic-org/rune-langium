// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { SegmentNode } from '../utils/namespace-tree.js';
import { namespaceTreeScope } from '../utils/namespace-tree-presentation.js';

function applyExpansionChoices(defaults: ReadonlySet<string>, choices: ReadonlyMap<string, boolean>): Set<string> {
  const expanded = new Set(defaults);
  for (const [path, open] of choices) {
    if (open) expanded.add(path);
    else expanded.delete(path);
  }
  return expanded;
}

/** New inventory uses defaults; only explicit navigation choices are state. */
export function useNamespaceExpansion(defaults: ReadonlySet<string>) {
  const [choices, setChoices] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const expanded = useMemo(() => applyExpansionChoices(defaults, choices), [defaults, choices]);
  const setExpanded = useCallback<Dispatch<SetStateAction<Set<string>>>>(
    (update) => {
      setChoices((previous) => {
        const before = applyExpansionChoices(defaults, previous);
        const after = typeof update === 'function' ? update(before) : update;
        const next = new Map(previous);
        for (const path of new Set([...before, ...after])) {
          if (before.has(path) !== after.has(path)) next.set(path, after.has(path));
        }
        return next;
      });
    },
    [defaults]
  );
  return [expanded, setExpanded] as const;
}

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
