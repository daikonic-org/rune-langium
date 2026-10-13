// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * useModelSourceSync — fire `onModelChanged` (serialized source per namespace)
 * whenever the editor-store's node/edge DATA changes, independent of which
 * visual pane (Graph, Structure, or none) is mounted.
 *
 * @remarks
 * Previously this subscription lived inside `RuneTypeGraph`. Because
 * `CenterStackPanel` conditionally mounts only the active pane, the Graph
 * pane was unmounted while the user worked in the Structure pane, so the
 * subscription never fired and the source text fell out of sync with store
 * edits. Lifting the hook here and mounting it unconditionally in `EditorPage`
 * fixes the dead-pane regression (2026-05-21, fix/inspector-source-sync).
 *
 * Semantics (preserved verbatim from RuneTypeGraph):
 *   - Skips the very first emission after mount (initial-skip) — source pane
 *     already has authoritative parsed text at load time.
 *   - Short-circuits on position-only changes via a cheap content fingerprint
 *     that excludes `position`, `errors`, and `hasExternalRefs`.
 *   - Skips when serialized output is byte-for-byte equal to the previous
 *     emission (no-op store re-renders).
 *   - Observer publication stays automatic; explicit flush awaits the same receipt.
 */

import { useCallback, useEffect, useRef } from 'react';
import type { Patches } from 'mutative';
import type { DehydratedNode } from '@rune-langium/codegen/rosetta';
import type { TypeGraphNode, TypeGraphEdge } from '../types.js';
import { astRelevantProjection, nameFromNodeId } from '../store/node-projection.js';
import { renderNamespace } from '../serialize/cst-reuse-renderer.js';
import { buildDirtyIndex } from '../serialize/dirty-paths.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Cheap content fingerprint — ignores `position`, `errors`, and
 * `hasExternalRefs` so position-only mutations (drag, layout, fit-view) don't
 * trigger the serialization pipeline.
 *
 * Extracted from RuneTypeGraph's former source-sync effect and made the sole owner here.
 */
function computeContentFingerprint(nodes: TypeGraphNode[], edges: TypeGraphEdge[]): string {
  const nodeParts: string[] = [];
  // Sort by id so reordering (e.g. drag-reorder) doesn't churn the
  // fingerprint — graph-content equivalence is what we care about.
  const sortedNodes = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  for (const n of sortedNodes) {
    // Project to the AST-relevant subset: skip GraphMetadata that
    // changes on view-only operations (position, errors, hasExternalRefs).
    //
    // NOTE (Deliverable B — Phase 3D-2): `toDomain(n.data)` is intentionally
    // NOT used here. `toDomain` produces a different key-set than
    // `astRelevantProjection`: it adds the `extends`/`members` normalisation
    // keys and drops GraphMetadata fields (`namespace`, `comments`, …).
    // Switching to
    // `toDomain` here would silently re-fingerprint every model node on
    // first load and trigger a spurious `onModelChanged` emission (source
    // churn). `astRelevantProjection` is the STABLE content-fingerprint
    // contract — its key-set must not change.
    const projection = astRelevantProjection(n.data);
    try {
      nodeParts.push(`${n.id}:${JSON.stringify(projection)}`);
    } catch {
      // Cyclic structures (shouldn't happen post-strip but be safe).
      nodeParts.push(`${n.id}:?`);
    }
  }
  const edgeParts: string[] = [];
  const sortedEdges = [...edges].sort((a, b) => a.id.localeCompare(b.id));
  for (const e of sortedEdges) {
    edgeParts.push(`${e.id}:${e.data?.kind ?? ''}`);
  }
  return `n=${nodeParts.join('|')}#e=${edgeParts.join('|')}`;
}

// ---------------------------------------------------------------------------
// Pure helper — exported so it can be unit-tested without React
// ---------------------------------------------------------------------------

export interface BuildSourceArgs {
  nodes: TypeGraphNode[];
  edges: TypeGraphEdge[];
  originalSourceByNamespace: Map<string, string>;
  patches: Patches;
  /**
   * Mutative inverse patches accumulated since the last parse. Used to derive
   * the source ranges of genuinely-deleted elements so those ranges are
   * excluded from the assembled output. Defaults to [] (no deletions).
   */
  inversePatches?: Patches;
}

/** Pure: produce Map<namespace, full .rosetta source> via CST-reuse. */
export function buildSourceForNamespaces(args: BuildSourceArgs): Map<string, string> {
  const { nodes, edges, originalSourceByNamespace, patches, inversePatches = [] } = args;
  const dirty = buildDirtyIndex(patches);

  // Inheritance is carried on EDGES (extends / enum-extends), not on the
  // node's data subtree, so an inheritance change does NOT produce a `nodes`
  // patch. Reflect the edge-derived parent onto a shallow clone of node.data
  // and force-regenerate any node whose effective parent differs from the
  // original (dehydrated) value. Mirrors model-to-ast.ts:buildInheritanceMap.
  //
  // Bug fixes (Task 7 / B):
  //   B1 — changing an extends edge from parent A to parent B (both defined,
  //        different) must also force-dirty; the old logic only caught
  //        add/remove (original↔undefined).
  //   B2 — a cross-namespace parent must produce a QUALIFIED $refText
  //        (`<ns>.<Name>`), not a bare name that gets mis-linked.
  const inheritanceTarget = new Map<string, string>(); // sourceNodeId -> targetNodeId
  for (const e of edges) {
    if (e.data?.kind === 'extends' || e.data?.kind === 'enum-extends') {
      inheritanceTarget.set(e.source, e.target);
    }
  }
  // Build an id→node map for namespace lookup (needed for B2 cross-ns qualify).
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const forceDirtyNodeIds = new Set<string>();
  const effectiveNodes = nodes.map((n) => {
    const targetId = inheritanceTarget.get(n.id);
    const d = n.data as { $type?: string; superType?: { $refText?: string }; parent?: { $refText?: string } };
    const refKey = d.$type === 'RosettaEnumeration' ? 'parent' : 'superType';
    const original = (d as Record<string, { $refText?: string } | undefined>)[refKey]?.$refText;
    let effective: string | undefined;
    if (targetId !== undefined) {
      const targetNode = byId.get(targetId);
      const bare = nameFromNodeId(targetId);
      // Qualify with namespace when the parent lives in a different namespace.
      effective =
        targetNode && targetNode.meta.namespace !== n.meta.namespace ? `${targetNode.meta.namespace}.${bare}` : bare;
      // If the existing $refText already matches what we'd compute, keep it
      // byte-stable (no unnecessary force-dirty).
      if (original === effective) effective = original;
    }
    // Covers: add (undefined→defined), remove (defined→undefined), change A→B.
    if (effective !== original) {
      forceDirtyNodeIds.add(n.id);
      return cloneWithRef(n, refKey, effective); // effective may be undefined (remove)
    }
    return n; // inheritance unchanged — reuse as-is
  });

  // ---------------------------------------------------------------------------
  // Deletion: derive per-namespace ranges of genuinely-removed elements from
  // the inverse patches, then pass them into renderNamespace so those byte
  // ranges are excluded from the assembled output.
  //
  // Rename-safety: a `renameType` re-keys via (delete-old + set-new), so the
  // old id's inverse patch carries the SAME $cstRange that the renamed node now
  // occupies. Exclude any range still occupied by a current (non-deferred) node
  // so a rename does NOT drop the element from the source.
  // ---------------------------------------------------------------------------
  const occupied = new Set<string>();
  for (const n of nodes) {
    if (n.meta.deferred) continue;
    try {
      const r = (n.data as { $cstRange?: { offset: number; end: number } }).$cstRange;
      if (r) occupied.add(`${n.meta.namespace}:${r.offset}:${r.end}`);
    } catch {
      // Defensive: a malformed/poison node whose $cstRange getter throws must
      // not prevent the occupied-range guard from running for other nodes.
    }
  }
  const removalsByNs = new Map<string, Array<{ offset: number; end: number }>>();
  for (const p of inversePatches) {
    const path = p.path as (string | number)[];
    // Only whole-node inverse patches at path ['nodes', <id>].
    if (path[0] !== 'nodes' || path.length !== 2) continue;
    const node = p.value as
      | { meta?: { namespace?: string; deferred?: boolean }; data?: { $cstRange?: { offset: number; end: number } } }
      | undefined;
    const r = node?.data?.$cstRange;
    const ns = node?.meta?.namespace;
    if (!r || !ns || node?.meta?.deferred) continue;
    if (occupied.has(`${ns}:${r.offset}:${r.end}`)) continue; // renamed/replaced — not a deletion
    (removalsByNs.get(ns) ?? removalsByNs.set(ns, []).get(ns)!).push(r);
  }

  const baselineByNs = new Map<string, DehydratedNode[]>();
  const owners = new Map(nodes.map((node) => [node.id, node.meta.namespace]));
  for (const patch of inversePatches) {
    if (patch.path[0] !== 'nodes' || patch.path.length !== 2) continue;
    const old = patch.value as { meta?: { namespace?: string } } | undefined;
    if (old?.meta?.namespace) owners.set(String(patch.path[1]), old.meta.namespace);
  }
  for (const patch of inversePatches) {
    if (patch.path[0] !== 'nodes') continue;
    const namespace = owners.get(String(patch.path[1]));
    if (!namespace) continue;
    const old = patch.value as { $type?: string; data?: DehydratedNode } | undefined;
    const values = Array.isArray(old) ? old : old?.data ? [old.data] : old?.$type ? [old] : [];
    (baselineByNs.get(namespace) ?? baselineByNs.set(namespace, []).get(namespace)!).push(
      ...(values as DehydratedNode[])
    );
  }

  const byNs = new Map<string, TypeGraphNode[]>();
  for (const n of effectiveNodes) {
    if (n.meta.deferred) continue; // curated placeholders are never source
    const ns = n.meta.namespace;
    (byNs.get(ns) ?? byNs.set(ns, []).get(ns)!).push(n);
  }
  const out = new Map<string, string>();
  // Drive the render loop from the UNION of namespaces that have live nodes OR
  // pending removals. Without this, deleting the LAST element in a namespace
  // leaves byNs empty for that namespace → renderNamespace is never called →
  // the deleted type reappears on reparse. removalsByNs already holds the range
  // but it was never consumed. With the union, we call renderNamespace with
  // nodes: [] for removal-only namespaces; copyGapExcluding omits the deleted
  // range and the header/version/comments survive verbatim.
  for (const ns of new Set([...byNs.keys(), ...removalsByNs.keys()])) {
    const nsNodes = byNs.get(ns) ?? [];
    const originalSource = originalSourceByNamespace.get(ns);
    if (originalSource === undefined) continue; // no baseline to reuse — skip (degraded)
    const removedRanges = removalsByNs.get(ns) ?? [];
    // Backstop: an unexpected serializer error must never crash the source-sync
    // effect. Skip the failing namespace (do NOT write to out) so other
    // namespaces continue to serialize normally. The previous persisted text for
    // this namespace remains in effect until a successful serialize or reparse.
    try {
      out.set(
        ns,
        renderNamespace({
          nodes: nsNodes,
          originalSource,
          dirty,
          forceDirtyNodeIds,
          removedRanges,
          baselineNodes: [...nsNodes.map((node) => node.data), ...(baselineByNs.get(ns) ?? [])]
        })
      );
    } catch (err) {
      console.warn(`[cst-reuse] namespace "${ns}" serialization failed — skipping`, err);
    }
  }
  return out;
}

// Shallow-clone a node, replacing the inheritance ref field. $cstRange survives
// the shallow clone (it is a sibling field on data).
function cloneWithRef(n: TypeGraphNode, refKey: string, refText: string | undefined): TypeGraphNode {
  const data = { ...(n.data as Record<string, unknown>) };
  data[refKey] = refText === undefined ? undefined : { $refText: refText };
  return { ...n, data } as TypeGraphNode;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Fires `onModelChanged` (serialized source keyed by namespace name) whenever
 * `nodes` or `edges` change in content — independent of which visual pane is
 * currently mounted.
 *
 * @param nodes - Current nodes from the editor store.
 * @param edges - Current edges from the editor store.
 * @param onModelChanged - Callback invoked with a `Map<namespace, serializedText>`
 *   on each content change after the initial mount.
 */
export interface SourceSyncSnapshot {
  nodes: TypeGraphNode[];
  edges: TypeGraphEdge[];
  parseEpoch: number;
  patches: Patches;
  inversePatches: Patches;
}
export interface SourceSyncHandle {
  flush(snapshot: SourceSyncSnapshot): Promise<void>;
}

export function useModelSourceSync(
  nodes: TypeGraphNode[],
  edges: TypeGraphEdge[],
  onModelChanged?: (serialized: Map<string, string>) => void | Promise<void>,
  /**
   * The editor store's `parseEpoch` — bumped ONLY when the graph is (re)built
   * from a parse result. Used to gate serialization: a `nodes`/`edges` change
   * that arrives together with a `parseEpoch` bump came FROM the source (a
   * parse), so serializing it back is pointless and — for a degraded reparse
   * (worker unavailable) — actively corrupts the file. We serialize ONLY when
   * the change is USER-EDIT-origin (parseEpoch unchanged since the last run).
   * Optional/defaulted so non-studio callers (tests, standalone) keep the old
   * "serialize every content change" behavior.
   */
  parseEpoch = 0,
  /**
   * The store's accumulated Mutative patches since the last parse. Drives the
   * CST-reuse dirty set: only nodes/subtrees touched by a patch are
   * regenerated; everything else is sliced verbatim from originalSourceByNamespace.
   */
  patches: Patches = [],
  /**
   * Original source text keyed by namespace name — used as the CST baseline for
   * the reuse serializer. Built by the caller from the current workspace files.
   * Defaults to an empty map so legacy/test callers that don't supply it get an
   * empty output (no write-back).
   */
  originalSourceByNamespace: Map<string, string> = new Map(),
  /**
   * The store's accumulated Mutative INVERSE patches since the last parse.
   * Used to derive the source byte ranges of genuinely-deleted elements so
   * those ranges are omitted from the assembled output. Defaults to [] so
   * legacy/test callers without deletion support keep the old behavior.
   */
  inversePatches: Patches = []
): SourceSyncHandle {
  // Keep a stable ref so the effect doesn't need to re-register when the
  // callback identity changes (e.g. inline arrow in EditorPage).
  const onModelChangedRef = useRef(onModelChanged);
  useEffect(() => {
    onModelChangedRef.current = onModelChanged;
  }, [onModelChanged]);

  const lastSerializedRef = useRef<Map<string, string> | null>(null);
  const hasFiredInitialSerializeRef = useRef(false);
  const lastContentFingerprintRef = useRef<string | null>(null);
  const lastParseEpochRef = useRef(parseEpoch);

  // PARSE-BASELINE source (offset-drift fix). Each dehydrated node's `$cstRange`
  // offsets index the EXACT source text the parser consumed; they are only
  // re-stamped on a reparse (which bumps `parseEpoch`). The `originalSourceByNamespace`
  // the caller passes is built from LIVE file content, which DIVERGES from those
  // offsets the moment the first write-back mutates the file. Slicing the
  // already-mutated live text with stale baseline offsets corrupts clean siblings
  // on a SECOND edit made before a reparse re-stamps `$cstRange`.
  //
  // Freeze the baseline here and advance it ONLY when `parseEpoch` advances, so
  // it stays in lockstep with `$cstRange`. Every serialize between reparses then
  // slices the exact text the offsets point at — never live file content.
  // Initialised to the mount-time source (the authoritative parsed text at load).
  const parseBaselineSourceRef = useRef(originalSourceByNamespace);

  const rendered = useRef({ parseEpoch, originalSourceByNamespace });
  rendered.current = { parseEpoch, originalSourceByNamespace };
  const pending = useRef<Promise<void>>(Promise.resolve());
  const busy = useRef(false);
  const queued = useRef<Map<string, string> | null>(null);
  const publish = useCallback((snapshot: SourceSyncSnapshot, explicit: boolean): Promise<void> => {
    const { nodes, edges, parseEpoch, patches, inversePatches } = snapshot;
    const handler = onModelChangedRef.current;
    if (!handler) return pending.current;
    const hasRemoval = inversePatches.some((p) => {
      const value = p.value as { meta?: { namespace?: string }; data?: { $cstRange?: unknown } } | undefined;
      return p.path[0] === 'nodes' && p.path.length === 2 && Boolean(value?.meta?.namespace && value?.data?.$cstRange);
    });
    if (nodes.length === 0 && !hasRemoval) return pending.current;
    // A new parse without edits needs no write-back. Only the observer may adopt its source baseline.
    if (explicit && parseEpoch !== lastParseEpochRef.current) {
      return patches.length > 0 || inversePatches.length > 0
        ? Promise.reject(new Error('Source has changed; wait for the current parse before switching workspaces.'))
        : pending.current;
    }
    const parseAdvanced = parseEpoch !== lastParseEpochRef.current;
    if (parseAdvanced) {
      lastParseEpochRef.current = parseEpoch;
      parseBaselineSourceRef.current = rendered.current.originalSourceByNamespace;
    }
    const fingerprint = computeContentFingerprint(nodes, edges);
    if (lastContentFingerprintRef.current === fingerprint) return pending.current;
    lastContentFingerprintRef.current = fingerprint;
    const next = buildSourceForNamespaces({
      nodes,
      edges,
      originalSourceByNamespace: parseBaselineSourceRef.current,
      patches,
      inversePatches
    });
    if (parseAdvanced || (!hasFiredInitialSerializeRef.current && (!explicit || patches.length === 0))) {
      hasFiredInitialSerializeRef.current = true;
      lastSerializedRef.current = next;
      return pending.current;
    }
    hasFiredInitialSerializeRef.current = true;
    const previous = queued.current ?? lastSerializedRef.current;
    if (previous && previous.size === next.size && [...next].every(([key, value]) => previous.get(key) === value))
      return pending.current;
    queued.current = next;
    // Keep publication receipts in order; a rejected receipt remains observable to flush.
    const start = () => {
      try {
        return Promise.resolve(handler(next));
      } catch (error) {
        return Promise.reject(error);
      }
    };
    const issued = busy.current ? pending.current.catch(() => {}).then(start) : start();
    busy.current = true;
    const receipt = issued
      .then(() => {
        lastSerializedRef.current = next;
        if (queued.current === next) queued.current = null;
      })
      .catch((error) => {
        if (queued.current === next) queued.current = null;
        lastContentFingerprintRef.current = null;
        throw error;
      });
    void receipt
      .finally(() => {
        if (pending.current === receipt) busy.current = false;
      })
      .catch(() => {});
    pending.current = receipt;
    return receipt;
  }, []);
  useEffect(() => {
    void publish({ nodes, edges, parseEpoch, patches, inversePatches }, false).catch(() => {});
  }, [nodes, edges, parseEpoch, patches, originalSourceByNamespace, inversePatches, publish]);
  return { flush: useCallback((snapshot: SourceSyncSnapshot) => publish(snapshot, true), [publish]) };
}
