// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { Import } from '../generated/ast.js';

/** File-local namespace imports, without runtime AST linkage. */
export type NamespaceImport = Pick<Import, 'importedNamespace' | 'namespaceAlias'>;

/** One alias may intentionally contribute several namespace prefixes. */
export function buildImportAliasMap(imports: readonly NamespaceImport[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const imp of imports) {
    if (!imp.namespaceAlias) continue;
    const namespace = imp.importedNamespace.endsWith('.*') ? imp.importedNamespace.slice(0, -2) : imp.importedNamespace;
    const targets = map.get(imp.namespaceAlias) ?? [];
    targets.push(namespace);
    map.set(imp.namespaceAlias, targets);
  }
  return map;
}

/** Shared by language scopes and views; a real qualified name keeps precedence. */
export function importAliasCandidates(name: string, aliases: ReadonlyMap<string, readonly string[]>): string[] {
  const dot = name.indexOf('.');
  if (dot === -1) return [name];
  return [name, ...(aliases.get(name.slice(0, dot)) ?? []).map((namespace) => `${namespace}.${name.slice(dot + 1)}`)];
}
