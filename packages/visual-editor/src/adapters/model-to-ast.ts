// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Model → AST adapter.
 *
 * Converts graph-node data back into serializer-compatible model objects.
 * `node.data` IS the pure `Dehydrated<T>` domain payload (Phase 3 step 3 —
 * no UI metadata to strip), so each element is just a shallow clone of the
 * data with edge-derived inheritance reflected onto it.
 *
 * Groups nodes by namespace and produces one RosettaModel per namespace.
 */

import type { TypeGraphNode, TypeGraphEdge } from '../types.js';
import { nameFromNodeId } from '../store/node-projection.js';
import { buildInheritanceMap } from '../utils/inheritance.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A serializer-compatible model object.
 * Same shape as the legacy SyntheticModel; elements are Dehydrated<T> clones.
 */
export interface ModelOutput {
  $type: 'RosettaModel';
  name: string;
  version: string;
  elements: unknown[];
  imports: never[];
}

// Keep legacy type names for backward compatibility
export type SyntheticModel = ModelOutput;
export type SyntheticElement = unknown;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert graph nodes and edges to serializer-compatible model objects.
 * Groups nodes by namespace and produces one model per namespace.
 */
export function modelsToAst(nodes: TypeGraphNode[], edges: TypeGraphEdge[]): ModelOutput[] {
  const inheritanceMap = buildInheritanceMap(edges);

  // Deferred-export placeholders (`meta.deferred`) are `{ $type, name }` stubs
  // for curated namespaces the user did NOT author — never serializable source.
  // Filtering here (the serialization boundary) covers every caller
  // (useModelSourceSync, exportRosetta, …), so no call site can forget the guard.
  const editableNodes = nodes.filter((n) => !n.meta.deferred);

  // Group nodes by namespace
  const byNamespace = new Map<string, TypeGraphNode[]>();
  for (const node of editableNodes) {
    const ns = node.meta.namespace;
    if (!byNamespace.has(ns)) byNamespace.set(ns, []);
    byNamespace.get(ns)!.push(node);
  }

  const models: ModelOutput[] = [];

  for (const [namespace, nsNodes] of byNamespace) {
    const elements: unknown[] = [];

    for (const node of nsNodes) {
      const d = node.data;
      // `data` is the pure domain payload — clone shallowly so the
      // inheritance write below cannot mutate the store's node.
      const model: Record<string, unknown> = { ...d };

      // Ensure inheritance is reflected in the model
      const parentNodeId = inheritanceMap.get(node.id);
      if (parentNodeId) {
        // Prefer the ref already on the lossless `data` payload: parse/edit
        // stores the correctly-QUALIFIED `$refText` there (e.g. "ns.a.Base"
        // for a cross-namespace parent), and re-emitting it verbatim is
        // byte-stable. Re-deriving from the edge id strips the namespace and
        // mislinks on reparse — only synthesize the bare name as a fallback
        // when `data` lacks the ref (edge created without the data-side ref).
        const existing = d as {
          superType?: { $refText?: string };
          parent?: { $refText?: string };
          superFunction?: { $refText?: string };
        };
        const parentName = nameFromNodeId(parentNodeId);
        // Strict `{ $refText }` ref shape (Phase 3 prep): the serializer reads
        // `$refText` when `ref` is absent, and hydration re-resolves the real
        // Reference from `$refText` — the synthesized `ref: { name }` was dead weight.
        if (d.$type === 'Data') {
          model.superType = { $refText: existing.superType?.$refText || parentName };
        } else if (d.$type === 'RosettaEnumeration') {
          model.parent = { $refText: existing.parent?.$refText || parentName };
        } else if (d.$type === 'RosettaFunction') {
          model.superFunction = { $refText: existing.superFunction?.$refText || parentName };
        }
      }

      elements.push(model);
    }

    models.push({
      $type: 'RosettaModel',
      name: namespace,
      version: '0.0.0',
      elements,
      imports: []
    });
  }

  return models;
}

// Re-export as graphToModels for backward compatibility
export { modelsToAst as graphToModels };
