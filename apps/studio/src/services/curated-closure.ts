// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { closeNamespaceDependencies, expandNamespaceWildcard } from '@rune-langium/core';
import { withInstrumentation, Capture } from './instrumentation/core.js';

export const expandWildcard = withInstrumentation(
  function expandWildcard(raw: string, allNs: ReadonlySet<string>): string[] {
    return expandNamespaceWildcard(raw, allNs);
    // `raw`/`allNs`/output are namespace strings that may be user-authored
    // (buildDependencyGraph below feeds this from user model imports too) —
    // never captured; only a count.
  },
  {
    op: 'expandWildcard',
    capture: Capture.Output,
    sanitize: (value, which) => (which === 'output' && Array.isArray(value) ? { count: value.length } : undefined)
  }
);

export const closeNamespacesFromManifest = withInstrumentation(
  function closeNamespacesFromManifest(
    seedNamespaces: Iterable<string>,
    namespaces: Readonly<Record<string, { deps: readonly string[] }>>
  ): Set<string> {
    const allNs = new Set(Object.keys(namespaces));
    const visited = new Set<string>();
    const queue: string[] = [...seedNamespaces].flatMap((raw) => expandWildcard(raw, allNs));
    while (queue.length > 0) {
      const ns = queue.shift()!;
      if (!allNs.has(ns) || visited.has(ns)) continue;
      visited.add(ns);
      for (const raw of namespaces[ns]!.deps) {
        for (const target of expandWildcard(raw, allNs)) {
          if (!visited.has(target)) queue.push(target);
        }
      }
    }
    return visited;
    // Same namespace-privacy rationale as expandWildcard above.
  },
  {
    op: 'closeNamespacesFromManifest',
    capture: Capture.Output,
    sanitize: (value, which) => (which === 'output' && value instanceof Set ? { count: value.size } : undefined)
  }
);

export const buildDependencyGraph = withInstrumentation(
  function buildDependencyGraph(
    userModels: ReadonlyArray<{ namespace: string; imports: readonly string[] }>,
    curatedDeps: ReadonlyMap<string, ReadonlySet<string>>,
    allNamespaces: ReadonlySet<string>,
    userResolvedDeps?: ReadonlyMap<string, ReadonlySet<string>>
  ): Record<string, string[]> {
    const directDeps = new Map<string, Set<string>>();
    const ensure = (ns: string): Set<string> => {
      let s = directDeps.get(ns);
      if (!s) {
        s = new Set<string>();
        directDeps.set(ns, s);
      }
      return s;
    };

    // Every namespace is a key even with no deps: consumers read Object.keys as
    // the namespace list, and a selected ns with no closure entry emits itself.
    for (const ns of allNamespaces) ensure(ns);

    // Curated → curated (precomputed manifest edges). Filter to known namespaces.
    for (const [ns, targets] of curatedDeps) {
      const bucket = ensure(ns);
      for (const t of targets) if (allNamespaces.has(t)) bucket.add(t);
    }

    // User → curated from import declarations, wildcard-expanded. Import edges
    // target ONLY curated namespaces: user→user deps are captured precisely by
    // userResolvedDeps below (resolved refs), so adding import-based user→user
    // edges here would over-pull an imported-but-unused user namespace into the
    // read-only Download-modal cascade (Codex P2).
    const userNamespaces = new Set(userModels.map((m) => m.namespace));
    for (const { namespace, imports } of userModels) {
      const bucket = ensure(namespace);
      for (const raw of imports) {
        for (const t of expandWildcard(raw, allNamespaces)) {
          if (t !== namespace && !userNamespaces.has(t)) bucket.add(t);
        }
      }
    }

    // User → user resolved edges (qualified refs the DSL resolves via global
    // scope without an import). Filter to known namespaces; drop self-edges.
    if (userResolvedDeps) {
      for (const [ns, targets] of userResolvedDeps) {
        const bucket = ensure(ns);
        for (const t of targets) if (t !== ns && allNamespaces.has(t)) bucket.add(t);
      }
    }

    const graph: Record<string, string[]> = {};
    for (const ns of allNamespaces) {
      graph[ns] = [...closeNamespaceDependencies(ns, directDeps)].sort();
    }
    return graph;
    // `userModels` carries user namespace/import names and the output graph is
    // keyed by (possibly user-authored) namespaces — never captured raw.
  },
  {
    op: 'buildDependencyGraph',
    capture: Capture.Output,
    sanitize: (value, which) =>
      which === 'output' ? { namespaceCount: Object.keys(value as Record<string, unknown>).length } : undefined
  }
);
