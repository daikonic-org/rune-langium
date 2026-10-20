// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * NamespaceTreePicker — a compact segmented namespace tree for a popover.
 *
 * The inspector's type field opens this instead of a flat list, so picking a
 * type uses the SAME segmented-tree look as the namespace explorer (shared
 * `NamespaceSegmentHeaderRow` + the shared `buildSegmentedNamespaceTreeFromOptions`
 * builder). Built from `TypeOption[]`, virtualized for large models, with a
 * search box that auto-expands ancestors of matches.
 *
 * Path compression (`compressSingleChild`) is on: single-child namespace chains
 * collapse into one header (e.g. `com.rosetta`) so deep namespaces stay compact
 * in the narrow popover. Focus, breadcrumbs and collision labels share the
 * explorer's canonical presentation helpers.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@rune-langium/design-system/utils';
import { Input } from '@rune-langium/design-system/ui/input';
import type { TypeOption, TypeKind } from '../../types.js';
import {
  buildSegmentedNamespaceTreeFromOptions,
  compactSegmentedNamespaceTree,
  flattenSegmentedTree,
  filterSegmentedTree,
  ancestorPathsForMatches
} from '../../utils/namespace-tree.js';
import { NamespaceSegmentHeaderRow, NAMESPACE_TREE_TYPE_INDENT } from '../NamespaceSegmentHeaderRow.js';
import { NamespaceBreadcrumb, NamespaceTreeGuides } from '../NamespaceTreeChrome.js';
import { namespaceTreeIndent, namespaceTypeLabels } from '../../utils/namespace-tree-presentation.js';
import { useNamespaceScope } from '../../hooks/useNamespaceScope.js';
import { useVirtualTree } from '../../hooks/useVirtualTree.js';
import { getKindDotClass } from './TypeSelector.js';

export interface NamespaceTreePickerProps {
  /** Types to pick from. */
  options: TypeOption[];
  /** Currently selected value (highlighted), or null. */
  value: string | null;
  /** Called when a type row is clicked (or the clear row, with null). */
  onSelect: (value: string | null) => void;
  /** Restrict to specific kinds (mirrors TypeSelector.filterKinds). */
  filterKinds?: Array<TypeKind | 'builtin'>;
  /** Show a leading "— None —" clear row. */
  allowClear?: boolean;
  /** Autofocus the search box on mount (default true — it's a popover). */
  autoFocusSearch?: boolean;
  className?: string;
}

export function NamespaceTreePicker({
  options,
  value,
  onSelect,
  filterKinds,
  allowClear = false,
  autoFocusSearch = true,
  className
}: NamespaceTreePickerProps): React.ReactElement {
  const [searchQuery, setSearchQuery] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Filter options by kind before building the tree (same contract as TypeSelector).
  const filteredOptions = useMemo(() => {
    if (!filterKinds || filterKinds.length === 0) return options;
    const kindSet = new Set(filterKinds);
    return options.filter((opt) => kindSet.has(opt.kind));
  }, [options, filterKinds]);

  // Build the segmented tree from the (kind-filtered) options.
  const roots = useMemo(() => buildSegmentedNamespaceTreeFromOptions(filteredOptions), [filteredOptions]);

  // Default expansion: roots + their direct children, so the tree is usable on
  // open without expanding to every leaf. (Search overrides this below.)
  const [treeExpanded, setTreeExpanded] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const root of roots) {
      initial.add(root.fullPath);
      for (const child of root.children) initial.add(child.fullPath);
    }
    return initial;
  });

  const toggleExpand = useCallback((fullPath: string) => {
    setTreeExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(fullPath)) next.delete(fullPath);
      else next.add(fullPath);
      return next;
    });
  }, []);

  // While searching, force-expand every ancestor of a match so results show.
  const effectiveExpanded = useMemo(() => {
    if (searchQuery.trim()) return ancestorPathsForMatches(roots, searchQuery);
    return treeExpanded;
  }, [searchQuery, roots, treeExpanded]);

  const compactRoots = useMemo(() => compactSegmentedNamespaceTree(roots), [roots]);
  const { activeFocus, scopedRoots, focusNamespace } = useNamespaceScope(
    compactRoots,
    searchQuery,
    scrollRef,
    setTreeExpanded
  );
  const visibleRoots = useMemo(() => filterSegmentedTree(scopedRoots, searchQuery), [scopedRoots, searchQuery]);
  const labels = useMemo(() => namespaceTypeLabels(compactRoots, !!searchQuery.trim()), [compactRoots, searchQuery]);
  const flatRows = useMemo(
    () =>
      flattenSegmentedTree(visibleRoots, effectiveExpanded).map((row) =>
        row.kind === 'type' ? { ...row, qualifier: labels.get(row.nodeId)?.qualifier } : row
      ),
    [visibleRoots, effectiveExpanded, labels]
  );

  const virtualizer = useVirtualTree(flatRows, scrollRef);

  return (
    <div className={cn('flex w-64 flex-col', className)} data-slot="namespace-tree-picker">
      <div className="p-2 pb-1.5">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search types…"
            aria-label="Search types"
            autoFocus={autoFocusSearch}
            className="h-7 pl-7 text-xs"
            data-testid="nstp-search"
          />
        </div>
      </div>

      {allowClear && (
        <button
          type="button"
          onClick={() => onSelect(null)}
          data-testid="nstp-clear"
          className={cn(
            'flex h-7 w-full items-center px-3 text-xs text-muted-foreground hover:bg-accent/50',
            value === null && 'bg-accent text-accent-foreground'
          )}
        >
          — None —
        </button>
      )}

      <NamespaceBreadcrumb path={activeFocus} onFocus={focusNamespace} />
      <div ref={scrollRef} className="studio-scroll max-h-72 flex-1 overflow-auto" data-testid="nstp-tree">
        {flatRows.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">
            {searchQuery ? 'No matching types' : 'No types available'}
          </p>
        ) : (
          <div style={{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = flatRows[virtualRow.index]!;
              return (
                <div
                  key={virtualRow.key}
                  style={{
                    position: 'absolute',
                    top: `${virtualRow.start}px`,
                    left: 0,
                    width: '100%',
                    height: `${virtualRow.size}px`
                  }}
                >
                  {row.kind === 'segment' ? (
                    <NamespaceSegmentHeaderRow
                      data-testid={`nstp-seg-${row.fullPath}`}
                      fullPath={row.fullPath}
                      label={row.segment || '(default)'}
                      onFocus={() => focusNamespace(row.fullPath)}
                      expanded={row.expanded}
                      count={row.totalCount}
                      depth={row.depth}
                      onToggle={() => toggleExpand(row.fullPath)}
                      indentPx={namespaceTreeIndent(row.depth)}
                    />
                  ) : row.kind === 'type' ? (
                    <button
                      type="button"
                      data-testid={`nstp-type-${row.nodeId}`}
                      onClick={() => onSelect(row.nodeId)}
                      style={{
                        paddingLeft: `${namespaceTreeIndent(Math.max(0, (row.depth ?? 1) - 1)) + NAMESPACE_TREE_TYPE_INDENT}px`,
                        height: '100%'
                      }}
                      title={labels.get(row.nodeId)?.fullLabel}
                      aria-label={`${row.name}${labels.get(row.nodeId)?.qualifier ? ` ${labels.get(row.nodeId)!.qualifier}` : ''}`}
                      aria-current={row.nodeId === value ? 'true' : undefined}
                      className={cn(
                        'rune-namespace-type-row relative flex w-full items-center gap-2 pr-2 text-xs text-foreground hover:bg-accent/50',
                        row.nodeId === value && 'bg-accent text-accent-foreground'
                      )}
                    >
                      <NamespaceTreeGuides depth={row.depth ?? 1} />
                      <span
                        className={cn('inline-block size-2 shrink-0 rounded-full', getKindDotClass(row.typeKind))}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 text-left">
                        <span className="block truncate">{row.name}</span>
                        {labels.get(row.nodeId)?.qualifier && (
                          <>
                            {' '}
                            <span className="block truncate text-3xs text-muted-foreground">
                              {labels.get(row.nodeId)!.qualifier}
                            </span>
                          </>
                        )}
                      </span>
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
