// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { LangiumDocument } from 'langium';
import { isChoice, isData, isRosettaModel, type Choice, type Data, type TypeCall } from '@rune-langium/core';
import { resolveTypeCallTarget, type TypeIndexLookup, type TypeResolutionVisitor } from './emit/type-ref-resolver.js';

/**
 * `resolveTypeCallTarget` requires a `TypeIndexLookup` for its refText-based
 * FALLBACK path only (single-document-parsed-without-full-workspace
 * scenarios) — `buildTypeReferenceGraph` always operates on already-linked
 * `docs` (this module's callers all build through Langium's DocumentBuilder
 * first), so a real cross-reference's `.ref` is already populated and the
 * primary (`.ref`-based, alias-chasing) branch is all this ever needs. An
 * empty lookup keeps the fallback branch's behavior identical to before this
 * migration: a genuinely unresolved `.ref` still contributes no edge.
 */
const EMPTY_TYPE_INDEX: TypeIndexLookup = {
  enumByName: new Map(),
  dataByName: new Map(),
  choiceByName: new Map(),
  typeAliasByName: new Map()
};

/**
 * Resolve `typeCall` to a Data/Choice edge target, chasing any
 * `RosettaTypeAlias` chain transparently via the shared resolver — matches
 * every emitter's own value-emission resolution, so a graph edge exists for
 * exactly the same references the emitters actually depend on at
 * evaluation/declaration order. Returns `undefined` for primitives, Enums,
 * and unresolved references (none of which carry an emission-order
 * dependency here).
 */
function resolveGraphEdgeTarget(typeCall: TypeCall | undefined): Data | Choice | undefined {
  const visitor: TypeResolutionVisitor<Data | Choice | undefined> = {
    onPrimitive: () => undefined,
    onEnum: () => undefined,
    onData: (node) => node,
    onChoice: (node) => node,
    onUnresolved: () => undefined
  };
  return resolveTypeCallTarget(typeCall, EMPTY_TYPE_INDEX, visitor, '');
}

/**
 * A directed graph of type references.
 * Nodes are type names; edges represent "A references B" relationships.
 * FR-006 (cycle detection), FR-007 (topological ordering).
 */
export interface TypeReferenceGraph {
  /** All type names in the graph. */
  nodes: string[];
  /** Adjacency list: typeName → [referencedTypeNames]. */
  edges: Map<string, string[]>;
}

/**
 * Ensure `name` is present in `nodes`/`edges`, without duplicating either.
 * `edges.has(name)` (a Map lookup) doubles as the node-membership check —
 * an entry is always added to both `nodes` and `edges` together below — so
 * this stays O(1) per call instead of the O(n) `nodes.includes` scan that
 * made graph construction quadratic in the total type count for large
 * corpora (Codex PR #459 review, P2).
 */
function ensureNode(name: string, nodes: string[], edges: Map<string, Set<string>>): void {
  if (!edges.has(name)) {
    nodes.push(name);
    edges.set(name, new Set());
  }
}

/** Add a directed edge `from -> to`, ensuring both endpoints exist as nodes. */
function addEdge(from: string, to: string, nodes: string[], edges: Map<string, Set<string>>): void {
  ensureNode(from, nodes, edges);
  ensureNode(to, nodes, edges);
  edges.get(from)!.add(to);
}

/**
 * Walks all Data and Choice nodes in the given Langium documents and builds
 * a directed type-reference graph. Edges are added for:
 * - `extends` relationships (an edge from the extending type to its parent:
 *   `typeName → superType.name`, so parents emit first)
 * - `Attribute.typeCall.type` references (type → attribute type), including
 *   attributes typed BY a Choice (mirrors Data's own treatment — W2)
 * - `Choice.attributes[].typeCall.type` references (Choice → each option's
 *   Data type) — a Choice must emit AFTER all of its option types, same
 *   ordering constraint as Data → its attribute types.
 *
 * FR-006 (cycle detection prerequisite).
 *
 * @param docs - Parsed Langium documents to scan.
 * @param getNodeId - Derives each node's graph identity from its Data/Choice
 *   AST node. Defaults to the bare `.name`, which is safe when `docs` is
 *   scoped to a single namespace (the emitter pipeline's usage via
 *   `namespace-walker.ts`, where names are already unique). A caller
 *   building a graph across MULTIPLE namespaces (e.g. the studio's
 *   cross-namespace Form Preview) must pass a namespace-qualifying
 *   function instead — two distinct types in different namespaces sharing
 *   a bare name would otherwise collide into the same graph node and
 *   produce a false cycle.
 * @returns A TypeReferenceGraph representing all type relationships.
 */
export function buildTypeReferenceGraph(
  docs: LangiumDocument[],
  getNodeId: (node: Data | Choice) => string = (node) => node.name
): TypeReferenceGraph {
  const nodes: string[] = [];
  const edges: Map<string, Set<string>> = new Map();

  for (const doc of docs) {
    const model = doc.parseResult?.value;
    if (!model || !isRosettaModel(model)) continue;

    const rosettaModel = model;
    for (const element of rosettaModel.elements) {
      if (isChoice(element)) {
        const choiceName = getNodeId(element);
        ensureNode(choiceName, nodes, edges);
        for (const option of element.attributes) {
          const optionTarget = resolveGraphEdgeTarget(option.typeCall);
          if (optionTarget) {
            addEdge(choiceName, getNodeId(optionTarget), nodes, edges);
          }
        }
        continue;
      }

      if (!isData(element)) continue;

      const typeName = getNodeId(element);
      ensureNode(typeName, nodes, edges);

      // Add extends edge: this type → parent type
      if (element.superType?.ref) {
        addEdge(typeName, getNodeId(element.superType.ref), nodes, edges);
      }

      // Add attribute type reference edges — Data or Choice targets only
      // (primitives have no emission-order dependency). Chases any
      // RosettaTypeAlias chain via resolveGraphEdgeTarget so an
      // alias-typed attribute's dependency is tracked against its
      // TERMINAL target, not silently dropped (an alias node is neither
      // Data nor Choice, so a direct `.ref` check alone would miss it —
      // this previously left alias-mediated dependencies invisible to
      // both topo-sort ordering and cycle detection).
      for (const attr of element.attributes) {
        const attrTarget = resolveGraphEdgeTarget(attr.typeCall);
        if (!attrTarget) continue;
        addEdge(typeName, getNodeId(attrTarget), nodes, edges);
      }
    }
  }

  const edgesAsArrays = new Map<string, string[]>();
  for (const [node, neighbors] of edges) {
    edgesAsArrays.set(node, [...neighbors]);
  }
  return { nodes, edges: edgesAsArrays };
}

/** The shared Tarjan traversal for both type-cycle detection and namespace ordering. */
export function stronglyConnectedComponents(graph: TypeReferenceGraph): string[][] {
  const components: string[][] = [];

  // Tarjan's SCC algorithm
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Map<string, boolean>();
  const stack: string[] = [];
  let counter = 0;

  function strongConnect(v: string): void {
    index.set(v, counter);
    lowlink.set(v, counter);
    counter++;
    stack.push(v);
    onStack.set(v, true);

    const neighbors = graph.edges.get(v) ?? [];
    for (const w of neighbors) {
      if (!index.has(w)) {
        // w has not been visited
        strongConnect(w);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
      } else if (onStack.get(w)) {
        // w is on stack — it's in current SCC
        lowlink.set(v, Math.min(lowlink.get(v)!, index.get(w)!));
      }
    }

    // If v is a root of an SCC, pop the SCC from the stack
    if (lowlink.get(v) === index.get(v)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.set(w, false);
        scc.push(w);
      } while (w !== v);

      components.push(scc);
    }
  }

  for (const node of graph.nodes) {
    if (!index.has(node)) {
      strongConnect(node);
    }
  }

  return components;
}

/** A type is cyclic if its component has multiple members or it references itself. */
export function findCyclicTypes(graph: TypeReferenceGraph): Set<string> {
  return new Set(
    stronglyConnectedComponents(graph)
      .filter((component) => component.length > 1 || graph.edges.get(component[0]!)?.includes(component[0]!))
      .flat()
  );
}
