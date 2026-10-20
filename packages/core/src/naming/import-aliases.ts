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

export interface ImportScope {
  aliases: ReadonlyMap<string, readonly string[]>;
  namespaces: readonly string[];
  explicitImports: ReadonlyMap<string, string>;
}

/** File-local scope facts shared by language lookup and projected references. */
export function buildImportScope(namespace: string, imports: readonly NamespaceImport[]): ImportScope {
  return {
    aliases: buildImportAliasMap(imports),
    namespaces: [
      namespace,
      ...imports
        .filter((entry) => !entry.namespaceAlias && entry.importedNamespace.endsWith('.*'))
        .map((entry) => entry.importedNamespace.slice(0, -2))
    ],
    explicitImports: new Map(
      imports
        .filter((entry) => !entry.namespaceAlias && !entry.importedNamespace.endsWith('.*'))
        .map((entry) => [entry.importedNamespace.split('.').pop()!, entry.importedNamespace])
    )
  };
}

/** Ordered names for a file scope; bare fallback is for the language's outer scope. */
export function importScopeCandidates(name: string, scope: ImportScope): string[] {
  const candidates = new Set<string>();
  if (!name.includes('.')) {
    const explicit = scope.explicitImports.get(name);
    if (explicit) candidates.add(explicit);
    for (const namespace of scope.namespaces) candidates.add(`${namespace}.${name}`);
  }
  for (const candidate of importAliasCandidates(name, scope.aliases)) candidates.add(candidate);
  return [...candidates];
}
