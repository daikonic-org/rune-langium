// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { ChevronRight } from 'lucide-react';
import {
  namespaceTreeIndent,
  NAMESPACE_TREE_STEP,
  NAMESPACE_TREE_MAX_DEPTH
} from '../utils/namespace-tree-presentation.js';

/** Shared ancestor context for the explorer and the Inspector's type picker. */
export function NamespaceBreadcrumb({
  path,
  onFocus
}: {
  path: string | null;
  onFocus: (path: string | null) => void;
}) {
  const parts = path === null || path === '' ? [] : path.split('.');
  return (
    <nav
      aria-label="Namespace location"
      className="studio-scroll flex shrink-0 items-center gap-1 overflow-x-auto border-b px-2 py-1 text-xs"
    >
      <button
        type="button"
        onClick={() => onFocus(null)}
        aria-current={path === null ? 'location' : undefined}
        className="shrink-0 rounded px-1 py-1 text-foreground hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-ring"
      >
        All
      </button>
      {parts.map((part, i) => {
        const fullPath = parts.slice(0, i + 1).join('.');
        return (
          <span key={fullPath} className="inline-flex shrink-0 items-center gap-1">
            <ChevronRight aria-hidden="true" className="size-3 text-muted-foreground" />
            <button
              type="button"
              title={fullPath}
              aria-label={fullPath}
              aria-current={i === parts.length - 1 ? 'location' : undefined}
              onClick={() => onFocus(fullPath)}
              className="rounded px-1 py-1 text-foreground hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-ring"
            >
              {part}
            </button>
          </span>
        );
      })}
      {path === '' && <span aria-current="location">(default)</span>}
    </nav>
  );
}

/** Ancestor guides are row-local so virtualization never cuts a nested DOM tree. */
export function NamespaceTreeGuides({ depth }: { depth: number }) {
  const indent = namespaceTreeIndent(depth);
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0">
      {Array.from({ length: Math.min(depth, NAMESPACE_TREE_MAX_DEPTH) }, (_, i) => (
        <span
          key={i}
          className="absolute inset-y-0 border-l border-border/60"
          style={{ left: `${indent - (i + 1) * NAMESPACE_TREE_STEP + 3}px` }}
        />
      ))}
    </span>
  );
}
