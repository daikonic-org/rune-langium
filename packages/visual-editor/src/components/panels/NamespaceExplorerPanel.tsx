// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * NamespaceExplorerPanel — Tree-based namespace navigation panel.
 *
 * Renders a collapsible tree grouped by namespace. Expanding/collapsing
 * a namespace correlates with showing/hiding its types on the graph canvas.
 *
 * Uses @tanstack/react-virtual for virtualized rendering of large trees
 * and shadcn/ui primitives with lucide-react icons.
 */

import { useState, useMemo, useCallback, useEffect, useRef, memo } from 'react';
import type { JSX, DragEvent, MouseEvent, KeyboardEvent } from 'react';
import { ArrowUpRight, ChevronRight, ChevronDown, PlusSquare, MinusSquare, Link, Search } from 'lucide-react';
import { Input } from '@rune-langium/design-system/ui/input';
import { Button } from '@rune-langium/design-system/ui/button';
import { IconButtonGroup } from '@rune-langium/design-system/ui/icon-button-group';
import { NumberChiclet } from '@rune-langium/design-system/ui/number-chiclet';
import { Checkbox } from '@rune-langium/design-system/ui/checkbox';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@rune-langium/design-system/ui/tooltip';
import { KindBadge, KIND_LABEL } from '../KindBadge.js';
import {
  NamespaceSegmentHeaderRow,
  NAMESPACE_TREE_INDENT_BASE as TREE_INDENT_BASE,
  NAMESPACE_TREE_TYPE_INDENT as TREE_TYPE_INDENT
} from '../NamespaceSegmentHeaderRow.js';
import type { TypeKind } from '../../types.js';
import type { NodeRepository } from '../../store/node-repository.js';
import { NODE_TYPE_TO_AST_TYPE } from '../../adapters/model-helpers.js';
import type { AnyDomain } from '@rune-langium/core';
import {
  buildSegmentedNamespaceTree,
  compactSegmentedNamespaceTree,
  flattenSegmentedTree,
  filterSegmentedTree,
  filterSegmentedTreeByKind,
  ancestorPathsForMatches,
  collectSegmentSubtreePaths
} from '../../utils/namespace-tree.js';
import type { FlatTreeRow } from '../../utils/namespace-tree.js';
import type { SegmentNode } from '../../utils/namespace-tree.js';
import { selectionState, toggleVisible } from '../../utils/explorer-selection.js';
import type { ExplorerSelection } from '../../utils/explorer-selection.js';
import { useVirtualTree } from '../../hooks/useVirtualTree.js';
import { TYPE_REF_PAYLOAD_MIME, typeRefMimeForKind } from '../../types/structure-view.js';
import type { TypeRefPayload, TypeRefKind } from '../../types/structure-view.js';

// Flat-tree indent geometry is shared with the inspector tree picker; the SSoT
// lives in NamespaceSegmentHeaderRow. Aliased to the original local names to
// keep the call sites below unchanged.

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface NamespaceExplorerPanelProps {
  /** Repository over all graph nodes (full set, including hidden ones). */
  nodeRepository: NodeRepository;
  /** Set of currently expanded (visible) namespaces. */
  expandedNamespaces: Set<string>;
  /** Set of individually hidden node IDs. */
  hiddenNodeIds: Set<string>;
  /** Toggle a namespace's visibility on the graph. */
  onToggleNamespace: (namespace: string) => void;
  /** Expand all namespaces. */
  onExpandAll: () => void;
  /** Collapse all namespaces. */
  onCollapseAll: () => void;
  /** Called when the type name or navigation arrow is activated to select it in the graph. */
  onSelectNode?: (nodeId: string) => void;
  /** Currently selected node ID (for highlighting). */
  selectedNodeId?: string | null;
  /** Optional className for outer container. */
  className?: string;
  /** Omit the repeated heading when a host already supplies the panel title. */
  showHeading?: boolean;
  /** Total edge count for cross-namespace reference detection. */
  hiddenRefCounts?: Map<string, number>;
  /**
   * Canonical node id of the currently active drag source (used to render
   * the → arrow indicator next to the type name).
   */
  dragSourceId?: string;
  /**
   * Legacy drag-source marking callback, retained for caller compatibility.
   * Rows now use native dragging; the name and arrow handle navigation.
   */
  onSetDragSource?: (payload: TypeRefPayload) => void;
  /**
   * Previously used for double-click undo-on-navigate; no longer consumed
   * internally after Phase 13 redesign (row body is single-purpose).
   * Retained on the interface for back-compat with EditorPage pass-through.
   */
  onClearDragSource?: () => void;
  /** Optional controlled inclusion: row/name toggle it; the arrow navigates. */
  selection?: ExplorerSelection;
}

// ---------------------------------------------------------------------------
// typeKind → TypeRefPayload.kind mapping
//
// FlatTreeRow.typeKind uses lowercase TypeKind values ('data', 'choice', …)
// while TypeRefPayload.kind requires PascalCase literals. EVERY kind maps to a
// payload kind so every row is draggable — that avoids the WebKit/Safari
// behaviour where a non-draggable row falls back to a text/region selection on
// a drag attempt. Validity is enforced by each drop target's `accept` list, not
// here: Data/Choice/Enum/BasicType/Record/TypeAlias are valid attribute
// type-refs; Func/Annotation are draggable but accepted by no target (no-drop).
// ---------------------------------------------------------------------------

function toPayloadKind(typeKind: TypeKind): TypeRefKind {
  switch (typeKind) {
    case 'data':
      return 'Data';
    case 'choice':
      return 'Choice';
    case 'enum':
      return 'Enum';
    case 'basicType':
      return 'BasicType';
    case 'record':
      return 'Record';
    case 'typeAlias':
      return 'TypeAlias';
    case 'func':
      return 'Func';
    case 'annotation':
      return 'Annotation';
    default: {
      // TypeKind is a closed union, so this is unreachable today. The `never`
      // assertion makes adding a new TypeKind a COMPILE error here (forcing an
      // explicit mapping) rather than silently misclassifying it as Annotation.
      const _exhaustive: never = typeKind;
      void _exhaustive;
      return 'Annotation';
    }
  }
}

// ---------------------------------------------------------------------------
// Kind filter pills
// ---------------------------------------------------------------------------

/** Every TypeKind value — the keep-set baseline when gating a subset of kinds. */
const ALL_TYPE_KINDS: readonly TypeKind[] = [
  'data',
  'choice',
  'enum',
  'func',
  'record',
  'typeAlias',
  'basicType',
  'annotation'
];

/**
 * Kinds surfaced as toggle pills (matches the graph legend + KindBadge tokens).
 * `dotClass` resolves to the `--color-{kind}` token, so the pill accent tracks
 * the theme exactly like GraphLegend's swatches.
 */
type FilterKind = 'data' | 'choice' | 'enum' | 'func';

const EXPLORER_FILTER_KINDS: readonly FilterKind[] = ['data', 'choice', 'enum', 'func'];

const KIND_DOT_CLASS: Record<FilterKind, string> = {
  data: 'bg-data',
  choice: 'bg-choice',
  enum: 'bg-enum',
  func: 'bg-func'
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const NamespaceExplorerPanel = memo(function NamespaceExplorerPanel({
  nodeRepository,
  expandedNamespaces,
  hiddenNodeIds,
  selectedNodeId,
  // Copilot review: `onToggleNamespace` is intentionally unused inside the
  // panel after the e2e-batch Eye/EyeOff button removal. The prop is kept
  // on the public interface as a no-op pass-through so callers (currently
  // EditorPage) don't need to thread different props for the panel vs.
  // the Graph filter menu that still consumes the action.
  onToggleNamespace: _onToggleNamespace,
  onExpandAll,
  onCollapseAll,
  onSelectNode,
  className,
  showHeading = true,
  hiddenRefCounts,
  dragSourceId,
  onSetDragSource,
  selection,
  // Kept on the public props interface for back-compat only (see the
  // "intentionally NOT forwarded" comment at its TypeItemRow call site
  // below) — same no-op pass-through pattern as `_onToggleNamespace` above.
  onClearDragSource: _onClearDragSource
}: NamespaceExplorerPanelProps): JSX.Element {
  const [searchQuery, setSearchQuery] = useState('');
  // Local explorer kind filter (independent of graph visibility / GraphFilterMenu).
  // All-on by default; toggling a pill off prunes that kind from the tree.
  const [activeKinds, setActiveKinds] = useState<Set<TypeKind>>(() => new Set(EXPLORER_FILTER_KINDS));
  const scrollRef = useRef<HTMLDivElement>(null);

  const toggleKind = useCallback((kind: TypeKind) => {
    setActiveKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }, []);

  // Compact the authoritative tree before filtering, so search never changes
  // which declarations a namespace checkbox represents.
  const uncompressedRoots = useMemo(() => buildSegmentedNamespaceTree(nodeRepository), [nodeRepository]);
  const segmentedRootsRaw = useMemo(() => compactSegmentedNamespaceTree(uncompressedRoots), [uncompressedRoots]);

  // Apply the local kind filter FIRST so search + ancestor-expansion operate on
  // the kind-pruned tree. Only the pill-controlled kinds (data/choice/enum/func)
  // are gated; every other kind (record/typeAlias/basicType/annotation) is always
  // kept. When all pills are on the tree is returned unchanged (cheap no-op).
  const segmentedRoots = useMemo(() => {
    const allPillsOn = EXPLORER_FILTER_KINDS.every((k) => activeKinds.has(k));
    if (allPillsOn) return segmentedRootsRaw;
    // Keep-set = every kind, minus the pill kinds that are toggled off.
    const keepKinds = new Set<TypeKind>(ALL_TYPE_KINDS);
    for (const k of EXPLORER_FILTER_KINDS) {
      if (!activeKinds.has(k)) keepKinds.delete(k);
    }
    return filterSegmentedTreeByKind(segmentedRootsRaw, keepKinds);
  }, [segmentedRootsRaw, activeKinds]);

  // Default expansion: expand all depth-0 and depth-1 segments so the tree is
  // usable on first render without collapsing all the way to bare root segments.
  const [treeExpanded, setTreeExpanded] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const root of uncompressedRoots) {
      initial.add(root.fullPath);
      for (const child of root.children) {
        initial.add(child.fullPath);
      }
    }
    return initial;
  });

  // Compute effective tree expansion (auto-expand all ancestor paths when searching).
  const effectiveTreeExpanded = useMemo(() => {
    if (searchQuery.trim()) {
      return ancestorPathsForMatches(segmentedRoots, searchQuery);
    }
    return treeExpanded;
  }, [searchQuery, treeExpanded, segmentedRoots]);

  // Apply search filter to the segmented tree.
  const filteredRoots = useMemo(() => {
    if (!searchQuery.trim()) return segmentedRoots;
    return filterSegmentedTree(segmentedRoots, searchQuery);
  }, [segmentedRoots, searchQuery]);

  // Flatten for virtualization.
  const flatRows = useMemo((): FlatTreeRow[] => {
    const rows = flattenSegmentedTree(filteredRoots, effectiveTreeExpanded);
    // Re-apply hidden flag to type rows (flattenSegmentedTree always sets hidden=false).
    return rows.map((row) => {
      // The explorer omits per-namespace kind summaries. Clear the display
      // metadata too so virtualization reserves only the header's height.
      if (row.kind === 'segment') return { ...row, kindCounts: {} };
      if (row.kind === 'type' && hiddenNodeIds.has(row.nodeId)) {
        return { ...row, hidden: true };
      }
      return row;
    });
  }, [filteredRoots, effectiveTreeExpanded, hiddenNodeIds]);

  const selectionIds = useMemo(() => {
    const byNode = new Map<string, string>();
    if (selection === undefined) return { all: [] as string[], byNode };

    const selectionIdForNode = (nodeId: string): string => {
      const node = nodeRepository.byId(nodeId);
      const selectionId = node === undefined ? nodeId : (selection.getSelectionId?.(node) ?? node.id);
      byNode.set(nodeId, selectionId);
      return selectionId;
    };

    const visit = (segment: SegmentNode): string[] => {
      const ids = segment.types.map((type) => selectionIdForNode(type.nodeId));
      for (const child of segment.children) ids.push(...visit(child));
      return ids;
    };

    const all = [...new Set(filteredRoots.flatMap(visit))];
    return { all, byNode };
  }, [filteredRoots, nodeRepository, selection]);

  const namespaceSelection = useMemo(() => {
    const bySegment = new Map<string, { ids: string[]; namespaces: string[] }>();
    if (selection === undefined) return bySegment;

    const selectionIdForNode = (nodeId: string): string => {
      const node = nodeRepository.byId(nodeId);
      return node === undefined ? nodeId : (selection.getSelectionId?.(node) ?? node.id);
    };
    const namespaces = nodeRepository.namespaces();

    const visit = (segment: SegmentNode): string[] => {
      const ids = segment.types.map((type) => selectionIdForNode(type.nodeId));
      for (const child of segment.children) ids.push(...visit(child));
      const descendantNamespaces = namespaces.filter(
        (namespace) =>
          namespace === segment.fullPath || (segment.fullPath !== '' && namespace.startsWith(`${segment.fullPath}.`))
      );
      bySegment.set(segment.fullPath, {
        namespaces: descendantNamespaces,
        ids: [...new Set(ids)]
      });
      return ids;
    };

    for (const root of segmentedRootsRaw) visit(root);
    return bySegment;
  }, [nodeRepository, segmentedRootsRaw, selection]);

  const selectedSelectionIds = useMemo(
    () => new Set(selection === undefined ? [] : [...selection.explicit, ...selection.requiredBy.keys()]),
    [selection]
  );

  const toggleSelection = useCallback(
    (ids: readonly string[], checked: boolean) => {
      if (selection !== undefined) selection.onChange(toggleVisible(ids, selection.explicit, checked));
    },
    [selection]
  );

  const toggleNamespaceSelection = useCallback(
    (ids: readonly string[], namespaces: readonly string[], checked: boolean) => {
      if (selection !== undefined) {
        selection.onChange(toggleVisible(ids, selection.explicit, checked), {
          kind: 'namespace',
          namespaces,
          checked
        });
      }
    },
    [selection]
  );

  const virtualizer = useVirtualTree(flatRows, scrollRef);

  // Expand only single-child chains. Branches require their own click;
  // collapsing clears descendants so reopening cannot reveal stale branches.
  const toggleTreeExpand = useCallback(
    (fullPath: string) => {
      setTreeExpanded((prev) => {
        const next = new Set(prev);
        const collapsing = next.has(fullPath);
        const subtree = collectSegmentSubtreePaths(segmentedRoots, fullPath, { singleChildOnly: !collapsing });
        if (collapsing) {
          for (const path of subtree) next.delete(path);
        } else {
          for (const path of subtree) next.add(path);
        }
        return next;
      });
    },
    [segmentedRoots]
  );

  const allNodes = nodeRepository.all();
  const totalTypes = allNodes.length;

  // Per-kind counts for the filter-pill badges — derived directly from the
  // repository's byType index so they reflect the full node set regardless of
  // the current tree filter state.
  const kindCounts = useMemo(() => {
    const counts = {} as Record<TypeKind, number>;
    for (const kind of EXPLORER_FILTER_KINDS) {
      counts[kind] = nodeRepository.byType(NODE_TYPE_TO_AST_TYPE[kind] as AnyDomain['$type']).length;
    }
    return counts;
  }, [nodeRepository]);

  return (
    // Explicit 0: the tree's dependency/ref-count rows want instant tooltips
    // (dense, frequently-hovered UI) — preserve that pre-existing behavior
    // against the shared TooltipProvider's now-nonzero default (tooltip.tsx).
    <TooltipProvider delayDuration={0}>
      <div className={`flex flex-col h-full bg-card ${className ?? ''}`} data-testid="namespace-explorer">
        {/* Header */}
        <div className="px-3 py-2 border-b">
          <div
            className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${showHeading ? 'justify-between' : 'justify-end'}`}
          >
            {showHeading && <span className="text-sm font-semibold">Type explorer</span>}
            <NumberChiclet data-testid="namespace-explorer-count">{totalTypes} available</NumberChiclet>
          </div>
          <p className="mt-1 text-2xs text-muted-foreground">
            {selection
              ? 'Click a row to include or exclude it. Use the arrow to open.'
              : 'Click name or arrow to open. Drag a row to a type field.'}
          </p>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/80" />
            <Input
              type="text"
              placeholder="Filter types or namespaces..."
              aria-label="Filter types or namespaces"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-7 border-border/70 bg-background/55 pl-8 pr-2 text-2xs shadow-none placeholder:text-muted-foreground/70"
              data-testid="namespace-search"
            />
          </div>
          <IconButtonGroup>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={onExpandAll}
                    data-testid="expand-all"
                    className="rounded-full text-muted-foreground hover:bg-background/80 hover:text-foreground"
                  >
                    <PlusSquare className="size-3.5" />
                    <span className="sr-only">Show all</span>
                  </Button>
                }
              />
              <TooltipContent>Show all namespaces on graph</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={onCollapseAll}
                    data-testid="collapse-all"
                    className="rounded-full text-muted-foreground hover:bg-background/80 hover:text-foreground"
                  >
                    <MinusSquare className="size-3.5" />
                    <span className="sr-only">Hide all</span>
                  </Button>
                }
              />
              <TooltipContent>Hide all namespaces from graph</TooltipContent>
            </Tooltip>
          </IconButtonGroup>
        </div>

        {selection !== undefined && (
          <div className="flex items-center gap-2 border-b px-3 py-1.5">
            <Button
              type="button"
              variant="secondary"
              size="xs"
              data-testid="select-visible-results"
              onClick={() => toggleSelection(selectionIds.all, true)}
            >
              Select visible results
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              data-testid="clear-selection"
              disabled={selection.explicit.size === 0}
              onClick={() => selection.onChange(new Set())}
            >
              Clear selection
            </Button>
          </div>
        )}

        {/* Kind filter pills — a LOCAL explorer filter (independent of graph
            visibility / GraphFilterMenu). All-on by default; toggling a pill off
            prunes that kind from the tree and prunes now-empty namespaces. */}
        <div
          className="flex flex-wrap items-center gap-1 border-b px-3 py-1.5"
          role="group"
          aria-label="Filter types by kind"
          data-testid="kind-filter-pills"
        >
          {EXPLORER_FILTER_KINDS.map((kind) => {
            const active = activeKinds.has(kind);
            return (
              <button
                key={kind}
                type="button"
                onClick={() => toggleKind(kind)}
                aria-pressed={active}
                data-testid={`kind-filter-${kind}`}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs font-medium transition-colors ${
                  active
                    ? 'border-border bg-accent/60 text-foreground'
                    : 'border-border/50 bg-transparent text-muted-foreground/70 hover:text-muted-foreground'
                }`}
              >
                <span
                  className={`inline-block size-2 shrink-0 rounded-full ${KIND_DOT_CLASS[kind]} ${active ? '' : 'opacity-40'}`}
                  aria-hidden="true"
                />
                {KIND_LABEL[kind]}
                <span className="text-muted-foreground/70 tabular-nums">{kindCounts[kind]}</span>
              </button>
            );
          })}
        </div>

        {/* Virtualized Tree.
         *
         * `studio-scroll` is the shared scrollbar-chrome class defined in
         * apps/studio/src/styles.css. It uses native ::-webkit-scrollbar +
         * scrollbar-* properties so the scrollbar is fully draggable and
         * click-to-page works — see PR commit message for the click-through
         * root cause (was: wrapped in a redundant Radix ScrollArea). */}
        <div ref={scrollRef} className="studio-scroll flex-1 overflow-auto" data-testid="namespace-tree">
          {flatRows.length === 0 && (
            <p className="px-3 py-4 text-xs text-center text-muted-foreground">
              {searchQuery ? 'No matching types or namespaces' : 'No types loaded'}
            </p>
          )}
          {flatRows.length > 0 && (
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative'
              }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const row = flatRows[virtualRow.index]!;
                return (
                  <div
                    key={virtualRow.key}
                    style={{
                      position: 'absolute',
                      // Position via `top`, NOT `transform: translateY(...)`.
                      // WebKit/Safari refuses to initiate native HTML5 drag on a
                      // `draggable` element whose ancestor has a CSS transform, so
                      // the @tanstack/react-virtual default transform broke drag of
                      // every TypeItemRow in Safari (Chrome has no such bug). Using
                      // `top` keeps the rows free of a transformed ancestor.
                      top: `${virtualRow.start}px`,
                      left: 0,
                      width: '100%',
                      height: `${virtualRow.size}px`
                    }}
                  >
                    {row.kind === 'namespace' ? (
                      <NamespaceHeaderRow
                        row={row}
                        isGraphVisible={expandedNamespaces.has(row.namespace)}
                        onToggleTreeExpand={() => toggleTreeExpand(row.namespace)}
                      />
                    ) : row.kind === 'segment' ? (
                      <SegmentHeaderRow
                        row={row}
                        onToggleTreeExpand={() => toggleTreeExpand(row.fullPath)}
                        selectionIds={namespaceSelection.get(row.fullPath)?.ids ?? []}
                        selectionNamespaces={namespaceSelection.get(row.fullPath)?.namespaces ?? []}
                        selectedIds={selectedSelectionIds}
                        onToggleSelection={toggleNamespaceSelection}
                        showSelection={selection !== undefined}
                      />
                    ) : row.kind === 'type' ? (
                      <TypeItemRow
                        row={row}
                        isGraphVisible={expandedNamespaces.has(row.namespace)}
                        isSelected={row.nodeId === selectedNodeId}
                        refCount={hiddenRefCounts?.get(row.nodeId) ?? 0}
                        onSelectNode={() => onSelectNode?.(row.nodeId)}
                        isDragSource={dragSourceId === row.nodeId}
                        onSetDragSource={onSetDragSource}
                        selection={selection}
                        selectionId={selectionIds.byNode.get(row.nodeId)}
                        // onClearDragSource is intentionally NOT forwarded — the TypeItemRow
                        // no longer uses it. The panel-level prop is kept for back-compat only.
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
});

// ---------------------------------------------------------------------------
// NamespaceHeaderRow — a namespace header in the virtualized list
// ---------------------------------------------------------------------------

interface NamespaceHeaderRowProps {
  row: Extract<FlatTreeRow, { kind: 'namespace' }>;
  /**
   * Whether this namespace is currently visible in the Graph view. Kept for
   * styling the row's text color (visible → foreground, hidden → muted) so
   * users can see at a glance which namespaces the Graph filter has hidden.
   * Toggle UI for visibility was removed from the explorer (e2e-batch fix):
   * visibility is a Graph-only concept, managed via the Graph filter menu.
   */
  isGraphVisible: boolean;
  onToggleTreeExpand: () => void;
}

function NamespaceHeaderRow({ row, isGraphVisible, onToggleTreeExpand }: NamespaceHeaderRowProps): JSX.Element {
  // e2e-batch fix #11: signal that this namespace contains draggable items.
  // A subtle "grip" affordance appears on hover so users discover that types
  // INSIDE the namespace can be dragged to drop targets (Structure rows,
  // Source editor). The namespace header itself isn't draggable today —
  // that would need a new NamespaceRef payload kind — but the hover hint
  // points users toward the per-type drag affordance once expanded.
  return (
    <div data-testid={`ns-row-${row.namespace}`} className="group">
      <div
        className={`flex items-center gap-1 px-2 py-1 text-sm hover:bg-accent/50 cursor-default ${
          isGraphVisible ? 'text-foreground' : 'text-muted-foreground'
        }`}
      >
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onToggleTreeExpand}
          aria-label={row.expanded ? 'Collapse tree' : 'Expand tree'}
          className="shrink-0"
        >
          {row.expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </Button>

        <span className="flex-1 truncate text-xs font-medium cursor-pointer" onClick={onToggleTreeExpand}>
          {row.namespace}
        </span>

        {/* Drag-source affordance hint (hover-only). Subtle ⋮⋮ icon signals to
            the user that types inside are draggable. Stays hidden until hover
            so it doesn't compete visually with the type-count chiclet. */}
        <span
          className="shrink-0 px-1 text-3xs leading-none text-muted-foreground/60 opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden="true"
          title="Types in this namespace can be dragged onto Structure rows or the Source editor"
        >
          ⋮⋮
        </span>

        <NumberChiclet>{row.typeCount}</NumberChiclet>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SegmentHeaderRow — a nested segment header in the segmented tree
// ---------------------------------------------------------------------------

interface SegmentHeaderRowProps {
  row: Extract<FlatTreeRow, { kind: 'segment' }>;
  onToggleTreeExpand: () => void;
  selectionIds: readonly string[];
  selectionNamespaces: readonly string[];
  selectedIds: ReadonlySet<string>;
  onToggleSelection: (ids: readonly string[], namespaces: readonly string[], checked: boolean) => void;
  showSelection: boolean;
}

function SegmentHeaderRow({
  row,
  onToggleTreeExpand,
  selectionIds,
  selectionNamespaces,
  selectedIds,
  onToggleSelection,
  showSelection
}: SegmentHeaderRowProps): JSX.Element {
  const state = selectionState(selectionIds, selectedIds);
  return (
    <NamespaceSegmentHeaderRow
      data-testid={`ns-seg-${row.fullPath}`}
      fullPath={row.fullPath}
      truncateFrom="start"
      expanded={row.expanded}
      count={row.totalCount}
      depth={row.depth}
      onToggle={onToggleTreeExpand}
      indentPx={TREE_INDENT_BASE}
      leading={
        showSelection ? (
          <Checkbox
            checked={state === true}
            indeterminate={state === 'indeterminate'}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            onCheckedChange={(checked) => onToggleSelection(selectionIds, selectionNamespaces, checked === true)}
            aria-label={`Select ${row.fullPath || 'default'} namespace`}
            data-testid={`ns-seg-checkbox-${row.fullPath}`}
          />
        ) : undefined
      }
    />
  );
}

// ---------------------------------------------------------------------------
// TypeItemRow — a type item in the virtualized list
// ---------------------------------------------------------------------------

interface TypeItemRowProps {
  row: Extract<FlatTreeRow, { kind: 'type' }>;
  isGraphVisible: boolean;
  isSelected: boolean;
  refCount: number;
  onSelectNode: () => void;
  /** True when this row is the currently active drag source. */
  isDragSource: boolean;
  /**
   * Called on single-click on the row body (or Enter/Space on the row) to
   * mark this type as the active drag source. The row body is single-purpose.
   */
  onSetDragSource?: (payload: TypeRefPayload) => void;
  selection?: ExplorerSelection;
  selectionId?: string;
  // onClearDragSource is intentionally omitted — the TypeItemRow no longer
  // needs it. The panel-level prop is kept for interface back-compat only.
}

function TypeItemRow({
  row,
  // isGraphVisible / isDragSource / onSetDragSource intentionally
  // unused: the dim "hidden in graph" treatment and click-to-mark-as-
  // drag-source feature were removed by user iteration so the only
  // operations in the explorer are drag (HTML5 native) or activate the
  // type name / navigate arrow. The props stay on TypeItemRowProps so parent
  // wiring (EditorPage / tests) doesn't have to change.
  isGraphVisible: _isGraphVisible,
  isSelected,
  refCount,
  onSelectNode,
  isDragSource: _isDragSource,
  onSetDragSource: _onSetDragSource,
  selection,
  selectionId
}: TypeItemRowProps): JSX.Element {
  // Every kind maps to a payload kind, so every row is a drag source. That
  // avoids the WebKit fallback where a non-draggable row text/region-selects on
  // a drag attempt. Whether a drop is valid is decided by each target's
  // `accept` list (Func/Annotation are draggable but accepted nowhere).
  const payload: TypeRefPayload = {
    rune: 'type-ref',
    // FlatTreeRow uses 'namespace' (the namespace string); TypeRefPayload
    // calls this field 'namespaceUri'. They represent the same value.
    namespaceUri: row.namespace,
    typeId: row.nodeId,
    typeName: row.name,
    kind: toPayloadKind(row.typeKind)
  };

  const handleDragStart = (e: DragEvent<HTMLDivElement>) => {
    // Dual-MIME contract per Phase 4: canonical MIME carries the JSON payload;
    // kind-specific marker MIME is registered with an empty value so that drop
    // targets can filter by kind during dragover (when getData is unavailable).
    e.dataTransfer.setData(TYPE_REF_PAYLOAD_MIME, JSON.stringify(payload));
    e.dataTransfer.setData(typeRefMimeForKind(payload.kind), '');
    e.dataTransfer.effectAllowed = 'link';
  };

  // Row dragging and inclusion are independent of name/arrow navigation.
  // Nav-click triggers selection AND flashes the row briefly so the user
  // gets confirmation that the navigate fired — without it the explorer
  // and other panes update silently and you can't tell if your click was
  // registered. 500ms cleanup is enough for the eye to catch the pulse
  // without lingering past the next intent.
  const [justNavigated, setJustNavigated] = useState(false);
  useEffect(() => {
    if (!justNavigated) return;
    const id = window.setTimeout(() => setJustNavigated(false), 500);
    return () => window.clearTimeout(id);
  }, [justNavigated]);

  const handleNavClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      onSelectNode();
      if (!selection) setJustNavigated(true);
    },
    [onSelectNode, selection]
  );

  // Keep the row's keydown from also firing when the nav button has focus
  // and Enter/Space is pressed — the button's own click activation already
  // covers that path.
  const handleNavKeyDown = useCallback((e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.stopPropagation();
    }
  }, []);

  const requiredBy = selectionId === undefined ? undefined : selection?.requiredBy.get(selectionId);
  const isRequired = requiredBy !== undefined && requiredBy.length > 0;
  const isExplicit = selectionId !== undefined && selection?.explicit.has(selectionId) === true;
  const isSelectionChecked = isExplicit || isRequired;
  const setSelectionChecked = (checked: boolean) => {
    if (!selection || selectionId === undefined || (isRequired && !isExplicit)) return;
    selection.onChange(toggleVisible([selectionId], selection.explicit, checked));
  };
  const toggleSelection = () => setSelectionChecked(!isExplicit);
  const highlight = selection === undefined && isSelected;

  // Flat layout: the tree carries `depth` for structure/expansion, but type
  // rows do NOT step right with depth. They get a single fixed membership
  // indent past the segment header's baseline so they read as belonging to the
  // header above — independent of how deep that header sits in the hierarchy.
  return (
    <div
      className={`studio-type-row group relative flex ${selection ? 'cursor-pointer' : 'cursor-grab'} items-center gap-1.5 px-2 py-0.5 text-xs text-foreground hover:bg-accent/50${
        highlight ? ' studio-type-row--selected' : ''
      }${!selection && justNavigated ? ' studio-type-row--just-navigated' : ''}`}
      style={{ paddingLeft: `${TREE_INDENT_BASE + TREE_TYPE_INDENT}px` }}
      data-testid={`ns-type-${row.nodeId}`}
      draggable
      onDragStart={handleDragStart}
      onClick={selection ? toggleSelection : undefined}
    >
      {highlight && <span className="studio-type-pip" />}

      {selection !== undefined && selectionId !== undefined && (
        <>
          <Checkbox
            checked={isSelectionChecked}
            disabled={isRequired && !isExplicit}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            onCheckedChange={(checked) => setSelectionChecked(checked === true)}
            aria-label={isRequired ? `${row.name}, required by ${requiredBy.join(', ')}` : `Select ${row.name}`}
            data-testid={`ns-type-checkbox-${row.nodeId}`}
          />
          {isRequired && (
            <span
              aria-label={`Required by ${requiredBy.join(', ')}`}
              title={`Required by ${requiredBy.join(', ')}`}
              className="text-muted-foreground"
            >
              <Link className="size-3" />
            </span>
          )}
        </>
      )}

      <KindBadge kind={row.typeKind} shape="glyph" />

      <button
        type="button"
        className="min-w-0 flex-1 truncate text-left underline decoration-transparent underline-offset-2 hover:decoration-current focus-visible:outline-2 focus-visible:outline-ring"
        title={
          selection
            ? `Toggle ${row.name} inclusion`
            : `Open ${row.name} [${KIND_LABEL[row.typeKind]}] — drag the row to a type field`
        }
        data-testid={`ns-type-link-${row.nodeId}`}
        onClick={
          selection
            ? (event) => {
                event.stopPropagation();
                toggleSelection();
              }
            : handleNavClick
        }
        onKeyDown={handleNavKeyDown}
      >
        {row.name}
      </button>

      {refCount > 0 && (
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="inline-flex items-center gap-0.5 text-muted-foreground">
                <Link className="size-3" />
                <span className="text-3xs">{refCount}</span>
              </span>
            }
          />
          <TooltipContent>{refCount} hidden reference(s)</TooltipContent>
        </Tooltip>
      )}

      {/* The arrow uses the same navigation action as the name. */}
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={handleNavClick}
        onKeyDown={handleNavKeyDown}
        aria-label={`Navigate to ${row.name}`}
        data-testid={`ns-type-nav-${row.nodeId}`}
        className="ml-auto size-6 border border-border/60 opacity-40 transition-opacity hover:border-border hover:!opacity-100 focus:opacity-100 group-hover:opacity-80"
        tabIndex={0}
      >
        <ArrowUpRight className="size-3.5" />
      </Button>
    </div>
  );
}
