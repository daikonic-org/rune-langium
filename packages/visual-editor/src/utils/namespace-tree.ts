// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Namespace tree builder — groups graph nodes by namespace
 * for the NamespaceExplorerPanel.
 *
 * Exports two tree representations:
 *   1. Flat (buildNamespaceTree) — groups by full dotted namespace string.
 *      Used by the current NamespaceExplorerPanel + flattenNamespaceTree.
 *   2. Segmented (buildSegmentedNamespaceTree) — nests namespaces by segment.
 *      Foundation for the shared hierarchical NamespaceTree picker.
 */

import type { TypeGraphNode, TypeKind, NamespaceTreeNode, NamespaceTypeEntry, TypeOption } from '../types.js';
import { resolveNodeKind } from '../adapters/model-helpers.js';
import type { NodeRepository } from '../store/node-repository.js';

/**
 * Flattened row for virtualized rendering of the namespace tree.
 *
 * Three variants:
 *  - 'namespace' — a flat namespace header (used by the existing explorer).
 *  - 'type'      — a type entry under a namespace or segment.
 *                  `depth` is optional (defaults to 0) and is only set by
 *                  flattenSegmentedTree; existing consumers that don't read it
 *                  are unaffected (additive field).
 *  - 'segment'   — a nested segment header produced by flattenSegmentedTree.
 */
export type FlatTreeRow =
  | { kind: 'namespace'; namespace: string; typeCount: number; expanded: boolean }
  | {
      kind: 'type';
      nodeId: string;
      name: string;
      typeKind: TypeKind;
      namespace: string;
      hidden: boolean;
      /** Additional visible namespace/identity context; reserves a second row line. */
      qualifier?: string;
      /** Nesting depth within a segmented tree (0 = top level). Only set by
       *  flattenSegmentedTree; absent/undefined for rows from flattenNamespaceTree. */
      depth?: number;
    }
  | {
      kind: 'segment';
      /** Display label for this segment (may be compressed, e.g. "com.rosetta"). */
      segment: string;
      /** Full dotted path to the segment node (canonical key, always uncompressed). */
      fullPath: string;
      /** Number of types whose namespace EXACTLY equals fullPath. */
      typeCount: number;
      /** Number of direct child segment nodes. */
      childCount: number;
      /** Aggregate type count across this segment's entire subtree (all
       *  descendant leaves) — what the header count pill displays. */
      totalCount: number;
      /** Per-kind breakdown of the types DIRECTLY in this segment (namespace ===
       *  fullPath). Only kinds with count > 0 are present. Drives the compact
       *  kind-count chips under the segment header. */
      kindCounts: Partial<Record<TypeKind, number>>;
      expanded: boolean;
      depth: number;
    };

/** Compute a per-kind count map for a list of type entries (kinds with 0 omitted). */
export function countEntriesByKind(entries: readonly NamespaceTypeEntry[]): Partial<Record<TypeKind, number>> {
  const counts: Partial<Record<TypeKind, number>> = {};
  for (const entry of entries) {
    counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;
  }
  return counts;
}

/**
 * Build a sorted list of namespace tree entries from graph nodes.
 *
 * Groups nodes by `namespace`, counts per kind, and sorts
 * both namespaces and their child types alphabetically.
 *
 * Takes a `TypeGraphNode[]` (not a `NodeRepository`): this is a public,
 * exported utility with no in-repo callers, so its node-array signature is
 * kept stable. The internal, panel-facing `buildSegmentedNamespaceTree` is the
 * one sourced from the repository.
 */
export function buildNamespaceTree(nodes: TypeGraphNode[]): NamespaceTreeNode[] {
  const nsMap = new Map<string, NamespaceTypeEntry[]>();
  for (const node of nodes) {
    const entry = extractTypeEntry(node);
    if (!entry) continue;
    let bucket = nsMap.get(node.meta.namespace);
    if (bucket === undefined) {
      bucket = [];
      nsMap.set(node.meta.namespace, bucket);
    }
    bucket.push(entry);
  }
  const tree: NamespaceTreeNode[] = [];
  for (const [namespace, types] of nsMap) {
    types.sort((a, b) => a.name.localeCompare(b.name));
    tree.push({
      namespace,
      types,
      totalCount: types.length,
      dataCount: types.filter((t) => t.kind === 'data').length,
      choiceCount: types.filter((t) => t.kind === 'choice').length,
      enumCount: types.filter((t) => t.kind === 'enum').length,
      funcCount: types.filter((t) => t.kind === 'func').length
    });
  }
  tree.sort((a, b) => a.namespace.localeCompare(b.namespace));
  return tree;
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Filter namespace tree entries by a search query.
 *
 * Matches against both namespace name and type names.
 * Returns tree entries with only matching types (or the full
 * namespace if the namespace name itself matches).
 */
export function filterNamespaceTree(tree: NamespaceTreeNode[], query: string): NamespaceTreeNode[] {
  if (!query.trim()) return tree;

  const escapedQuery = escapeRegex(query);
  const regex = new RegExp(escapedQuery, 'i');
  const results: NamespaceTreeNode[] = [];

  for (const entry of tree) {
    // If namespace name matches, include all types
    if (regex.test(entry.namespace)) {
      results.push(entry);
      continue;
    }

    // Otherwise filter to matching types
    const matchingTypes = entry.types.filter((t) => regex.test(t.name));
    if (matchingTypes.length > 0) {
      results.push({
        ...entry,
        types: matchingTypes,
        totalCount: matchingTypes.length,
        dataCount: matchingTypes.filter((t) => t.kind === 'data').length,
        choiceCount: matchingTypes.filter((t) => t.kind === 'choice').length,
        enumCount: matchingTypes.filter((t) => t.kind === 'enum').length,
        funcCount: matchingTypes.filter((t) => t.kind === 'func').length
      });
    }
  }

  return results;
}

/**
 * Flatten the namespace tree into a single array of rows for virtualized rendering.
 *
 * Each namespace becomes a header row; its child types become individual rows
 * (only when the namespace is expanded). Hidden nodes and search filtering are applied.
 */
export function flattenNamespaceTree(
  tree: NamespaceTreeNode[],
  expandedNamespaces: Set<string>,
  hiddenNodeIds: Set<string>,
  searchQuery?: string
): FlatTreeRow[] {
  const filtered = searchQuery ? filterNamespaceTree(tree, searchQuery) : tree;
  const rows: FlatTreeRow[] = [];

  for (const entry of filtered) {
    const expanded = expandedNamespaces.has(entry.namespace);
    rows.push({
      kind: 'namespace',
      namespace: entry.namespace,
      typeCount: entry.totalCount,
      expanded
    });

    if (expanded) {
      for (const type of entry.types) {
        rows.push({
          kind: 'type',
          nodeId: type.nodeId,
          name: type.name,
          typeKind: type.kind,
          namespace: entry.namespace,
          hidden: hiddenNodeIds.has(type.nodeId)
        });
      }
    }
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Segmented namespace tree
// ---------------------------------------------------------------------------

/**
 * A node in the sub-namespace-segmented tree.
 *
 * Each node represents one path segment (e.g. `"model"` for the path
 * `"com.rosetta.model"`). A node can have BOTH direct `types` (when a real
 * namespace is declared at its `fullPath`) AND `children` (when deeper
 * namespaces exist below it).
 *
 * Types with an empty/undefined namespace are placed under a root segment
 * whose `segment` and `fullPath` are both `""` (the empty string). Callers
 * may render this as "(default)" or similar.
 */
export interface SegmentNode {
  /** This path segment (e.g. `"model"`). Root segments are top-level (e.g. `"com"`). */
  segment: string;
  /** Full dotted path to this node (e.g. `"com.rosetta.model"`). */
  fullPath: string;
  /** Types whose namespace EXACTLY equals `fullPath` (a real namespace at this path). */
  types: NamespaceTypeEntry[];
  /** Child sub-namespace segments, sorted by segment name (locale, case-insensitive). */
  children: SegmentNode[];
  /** Total types in this subtree (self types + all descendants' types). */
  totalCount: number;
}

/**
 * Extract a `NamespaceTypeEntry` from a graph node using the same logic as
 * `buildNamespaceTree`, so both builders produce identical entry objects.
 *
 * Returns `undefined` when `node.data` has no real (non-empty string) `name`
 * — e.g. a not-yet-hydrated curated stub node, or any domain `$type` whose
 * shape doesn't carry a `name` at all. `NamespaceTypeEntry.name` is typed as
 * a non-optional `string`; degrading to `''` would let a nameless ghost row
 * appear in the tree (and still requires every caller to guard the sort
 * comparator), so such nodes are excluded here instead of fabricated.
 */
function extractTypeEntry(node: TypeGraphNode): NamespaceTypeEntry | undefined {
  const d = node.data;
  const name = (d as { name?: unknown }).name;
  if (typeof name !== 'string' || name === '') return undefined;
  return {
    nodeId: node.id,
    name,
    kind: resolveNodeKind(node) as TypeKind
  };
}

/**
 * Build a sub-namespace-segmented tree from the node repository.
 *
 * Nests namespaces by splitting on `'.'`, so `"com.rosetta.model"` produces
 * a three-level chain `com → rosetta → model`. A namespace with both direct
 * types and deeper children has BOTH `types` and `children` populated.
 *
 * Edge cases:
 *  - Empty repository → returns `[]`.
 *  - Types with an empty namespace string are placed under a root segment
 *    with `segment = ""` and `fullPath = ""`.
 *
 * Root segments and each node's `children` are sorted locale-insensitively
 * by segment name. Each node's `types` are sorted by name.
 */
export function buildSegmentedNamespaceTree(repo: NodeRepository): SegmentNode[] {
  // Group TypeGraphNodes by their full namespace string, then defer to the
  // shared core. The graph-node and TypeOption builders differ ONLY in how
  // they normalize their input into this `namespace → entries` map; the tree
  // construction (nesting, totals, sorting) is identical, so it lives once.
  const nsMap = new Map<string, NamespaceTypeEntry[]>();
  for (const namespace of repo.namespaces()) {
    const entries = repo
      .byNamespace(namespace)
      .map(extractTypeEntry)
      .filter((entry) => entry !== undefined);
    // A namespace whose only nodes were dropped as nameless would otherwise
    // still land in `nsMap` with an empty array, producing a ghost header
    // with `totalCount: 0` in the explorer.
    if (entries.length > 0) nsMap.set(namespace, entries);
  }
  return buildSegmentsFromEntries(nsMap);
}

/**
 * Build a sub-namespace-segmented tree from `TypeOption[]` (the inspector's
 * type-picker shape) so the inspector tree picker and the namespace explorer
 * render from one builder. Built-in types carry no namespace and a `'builtin'`
 * pseudo-kind: we group them under a synthetic `"Built-in"` namespace and map
 * the kind to `'basicType'` (matching the dropdown's `kindToBadgeVariant`), so
 * they appear as their own header in the tree instead of an empty-string root.
 */
export function buildSegmentedNamespaceTreeFromOptions(options: TypeOption[]): SegmentNode[] {
  if (options.length === 0) return [];

  const nsMap = new Map<string, NamespaceTypeEntry[]>();
  for (const opt of options) {
    if (typeof opt.label !== 'string' || opt.label === '') continue;
    const isBuiltin = opt.kind === 'builtin';
    const ns = opt.namespace ?? (isBuiltin ? 'Built-in' : '');
    const kind = (isBuiltin ? 'basicType' : opt.kind) as TypeKind;
    if (!nsMap.has(ns)) nsMap.set(ns, []);
    nsMap.get(ns)!.push({ nodeId: opt.value, name: opt.label, kind });
  }
  return buildSegmentsFromEntries(nsMap);
}

/**
 * Shared core: turn a `namespace → entries` map into a sorted, totalled
 * `SegmentNode[]`. Both public builders normalize their domain input into this
 * map and delegate here, so the nesting/total/sort logic has a single home.
 */
function buildSegmentsFromEntries(nsMap: Map<string, NamespaceTypeEntry[]>): SegmentNode[] {
  if (nsMap.size === 0) return [];

  // Sort each namespace's types by name.
  for (const entries of nsMap.values()) {
    entries.sort((a, b) => a.name.localeCompare(b.name));
  }

  // 2. Build nested SegmentNode tree.
  //    rootMap: top-level segment → SegmentNode (unfinished; totalCount added later).
  const rootMap = new Map<string, SegmentNode>();

  /** Get-or-create a SegmentNode at the given path (expressed as segments array). */
  function getOrCreate(segments: string[]): SegmentNode {
    const fullPath = segments.join('.');
    const segment = segments[segments.length - 1]!;

    if (segments.length === 1) {
      if (!rootMap.has(segment)) {
        rootMap.set(segment, { segment, fullPath, types: [], children: [], totalCount: 0 });
      }
      return rootMap.get(segment)!;
    }

    // Ensure parent exists and this node is registered as its child.
    const parent = getOrCreate(segments.slice(0, -1));
    let child = parent.children.find((c) => c.segment === segment);
    if (!child) {
      child = { segment, fullPath, types: [], children: [], totalCount: 0 };
      parent.children.push(child);
    }
    return child;
  }

  // Insert each namespace's types into the tree.
  for (const [ns, entries] of nsMap) {
    const segments = ns === '' ? [''] : ns.split('.');
    const node = getOrCreate(segments);
    node.types = entries;
  }

  // 3. Compute totalCount (post-order) and sort children.
  function finalise(node: SegmentNode): void {
    node.children.sort((a, b) => a.segment.localeCompare(b.segment, undefined, { sensitivity: 'base' }));
    for (const child of node.children) finalise(child);
    node.totalCount = node.types.length + node.children.reduce((sum, c) => sum + c.totalCount, 0);
  }

  const roots = Array.from(rootMap.values());
  for (const root of roots) finalise(root);
  roots.sort((a, b) => a.segment.localeCompare(b.segment, undefined, { sensitivity: 'base' }));

  return roots;
}

/**
 * Filter a segmented namespace tree by a search query.
 *
 * Returns a pruned copy of the tree where:
 *  - A segment node is kept if ANY of the following are true:
 *      (a) The segment's `fullPath` matches the query (keep all descendants).
 *      (b) Any descendant type's `name` matches the query.
 *      (c) The segment has at least one matching direct type (subset kept).
 *  - Empty segments (no matching types in subtree) are pruned.
 *  - The caller receives modified nodes (copied, not mutated) with only
 *    matching types when a full-namespace match is absent.
 *
 * The function does NOT mutate the input tree.
 *
 * Returns the full tree unmodified when `query.trim()` is empty.
 */
export function filterSegmentedTree(roots: SegmentNode[], query: string): SegmentNode[] {
  if (!query.trim()) return roots;

  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escapedQuery, 'i');

  function visitNode(node: SegmentNode): SegmentNode | null {
    // If the segment's full path matches, include the entire subtree.
    if (regex.test(node.fullPath)) {
      return node;
    }

    // Filter direct types by name.
    const matchingTypes = node.types.filter((t) => regex.test(t.name));

    // Recurse into children.
    const matchingChildren: SegmentNode[] = [];
    for (const child of node.children) {
      const filtered = visitNode(child);
      if (filtered !== null) matchingChildren.push(filtered);
    }

    if (matchingTypes.length === 0 && matchingChildren.length === 0) {
      return null; // prune
    }

    // Return a shallow copy with only matching contents.
    const filteredTotalCount = matchingTypes.length + matchingChildren.reduce((s, c) => s + c.totalCount, 0);

    return {
      ...node,
      types: matchingTypes,
      children: matchingChildren,
      totalCount: filteredTotalCount
    };
  }

  const result: SegmentNode[] = [];
  for (const root of roots) {
    const filtered = visitNode(root);
    if (filtered !== null) result.push(filtered);
  }
  return result;
}

/**
 * Filter a segmented namespace tree to only types whose kind is in `activeKinds`.
 *
 * Mirrors `filterSegmentedTree`'s pruning contract: segments with no surviving
 * direct types and no surviving children are pruned, and `totalCount` is
 * recomputed from the kept contents. Pure (does not mutate the input).
 *
 * `activeKinds` is the set of currently-enabled kinds (the explorer's kind
 * filter pills). When it covers every kind present in the tree the result is
 * structurally equal to the input, but always a fresh shallow copy — the
 * function allocates new arrays/objects and never returns the input references,
 * so callers must not rely on referential equality for memoization.
 */
export function filterSegmentedTreeByKind(roots: SegmentNode[], activeKinds: ReadonlySet<TypeKind>): SegmentNode[] {
  function visitNode(node: SegmentNode): SegmentNode | null {
    const matchingTypes = node.types.filter((t) => activeKinds.has(t.kind));

    const matchingChildren: SegmentNode[] = [];
    for (const child of node.children) {
      const filtered = visitNode(child);
      if (filtered !== null) matchingChildren.push(filtered);
    }

    if (matchingTypes.length === 0 && matchingChildren.length === 0) {
      return null; // prune
    }

    const filteredTotalCount = matchingTypes.length + matchingChildren.reduce((s, c) => s + c.totalCount, 0);

    return {
      ...node,
      types: matchingTypes,
      children: matchingChildren,
      totalCount: filteredTotalCount
    };
  }

  const result: SegmentNode[] = [];
  for (const root of roots) {
    const filtered = visitNode(root);
    if (filtered !== null) result.push(filtered);
  }
  return result;
}

/**
 * Compute the set of all segment `fullPath`s that are ancestors of nodes that
 * contain matching types. Used by the explorer to auto-expand ancestor segments
 * so that filtered results are immediately visible.
 *
 * The returned set includes every ancestor's `fullPath` AND the matching
 * node's own `fullPath`, so the matched node's types/children are revealed
 * in the explorer (not just the ancestors above it).
 */
export function ancestorPathsForMatches(roots: SegmentNode[], query: string): Set<string> {
  if (!query.trim()) return new Set();

  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escapedQuery, 'i');
  const ancestorPaths = new Set<string>();

  function visitNode(node: SegmentNode, ancestors: string[]): boolean {
    // Check if this node's fullPath itself matches (include all children visible)
    const selfMatch = regex.test(node.fullPath);

    let subtreeHasMatch = selfMatch || node.types.some((t) => regex.test(t.name));

    for (const child of node.children) {
      if (visitNode(child, [...ancestors, node.fullPath])) {
        subtreeHasMatch = true;
      }
    }

    if (subtreeHasMatch) {
      for (const ancestor of ancestors) {
        ancestorPaths.add(ancestor);
      }
      // Also include this node's fullPath so its types/children are revealed.
      ancestorPaths.add(node.fullPath);
    }

    return subtreeHasMatch;
  }

  for (const root of roots) {
    visitNode(root, []);
  }

  return ancestorPaths;
}

/**
 * Collect a segment's own `fullPath` plus every descendant segment `fullPath`
 * in its subtree. Collapse includes all descendants; expansion can follow
 * only single-child namespace chains, stopping at each branching point.
 *
 * The requested `fullPath` is always included (even if not found in the tree)
 * so the caller degrades to a single-path toggle rather than a no-op.
 */
export function collectSegmentSubtreePaths(
  roots: SegmentNode[],
  fullPath: string,
  options: { singleChildOnly?: boolean } = {}
): string[] {
  const paths = new Set<string>([fullPath]);

  function collectAll(node: SegmentNode): void {
    paths.add(node.fullPath);
    if (options.singleChildOnly && node.children.length !== 1) return;
    for (const child of node.children) collectAll(child);
  }

  function findAndCollect(node: SegmentNode): boolean {
    if (node.fullPath === fullPath) {
      collectAll(node);
      return true;
    }
    for (const child of node.children) {
      if (findAndCollect(child)) return true;
    }
    return false;
  }

  for (const root of roots) {
    if (findAndCollect(root)) break;
  }

  return [...paths];
}

/**
 * Join namespace chains that have no declarations or branching points.
 * Canonical full paths, declaration identities and subtree totals are retained.
 * Compact before filtering to keep namespace selection boundaries stable.
 */
export function compactSegmentedNamespaceTree(roots: readonly SegmentNode[]): SegmentNode[] {
  return roots.map((node) => {
    const labels = [node.segment];
    let cursor = node;
    while (cursor.types.length === 0 && cursor.children.length === 1) {
      cursor = cursor.children[0]!;
      labels.push(cursor.segment);
    }
    return {
      ...cursor,
      segment: labels.join('.'),
      children: compactSegmentedNamespaceTree(cursor.children)
    };
  });
}

/**
 * Flatten a segmented namespace tree into rows suitable for virtualized rendering.
 *
 * Each `SegmentNode` emits a `'segment'` row. When the segment is expanded
 * (its `fullPath` is in `expanded`), child segments are recursed first (DFS),
 * then the node's direct `types` are emitted as `'type'` rows at `depth + 1`.
 *
 * ### Path compression (`compressSingleChild`)
 * When `opts.compressSingleChild` is `true` (default `false`), any segment
 * node that has **no direct types** and **exactly one child** is merged with
 * that child transitively — producing a single `'segment'` row whose `segment`
 * label is the joined path (e.g. `"com.rosetta"`) and whose `fullPath` is the
 * compressed-to node's `fullPath`. This mirrors JetBrains-style package
 * compression. Callers that filter afterward can instead compact the source
 * tree first with `compactSegmentedNamespaceTree` to retain branch boundaries.
 *
 * The `expanded` set always uses `fullPath` keys (the uncompressed canonical
 * path), even when compression merges multiple segments into one row.
 */
export function flattenSegmentedTree(
  roots: SegmentNode[],
  expanded: Set<string>,
  opts?: { compressSingleChild?: boolean }
): FlatTreeRow[] {
  const visibleRoots = opts?.compressSingleChild ? compactSegmentedNamespaceTree(roots) : roots;
  const rows: FlatTreeRow[] = [];

  function visitNode(node: SegmentNode, depth: number): void {
    const isExpanded = expanded.has(node.fullPath);
    rows.push({
      kind: 'segment',
      segment: node.segment,
      fullPath: node.fullPath,
      typeCount: node.types.length,
      childCount: node.children.length,
      totalCount: node.totalCount,
      kindCounts: countEntriesByKind(node.types),
      expanded: isExpanded,
      depth
    });

    if (isExpanded) {
      for (const child of node.children) visitNode(child, depth + 1);
      for (const type of node.types) {
        rows.push({
          kind: 'type',
          nodeId: type.nodeId,
          name: type.name,
          typeKind: type.kind,
          namespace: node.fullPath,
          hidden: false,
          depth: depth + 1
        });
      }
    }
  }

  for (const root of visibleRoots) visitNode(root, 0);
  return rows;
}
