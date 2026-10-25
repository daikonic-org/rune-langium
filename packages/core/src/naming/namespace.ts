// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/** Matches the `namespace <QualifiedName>` declaration in `.rosetta` source. */
const NAMESPACE_SOURCE_RE = /^\s*namespace\s+([\w.]+)/m;

/** Expand an exact name or dotted-prefix wildcard against known namespaces. */
export function expandNamespaceWildcard(raw: string, allNamespaces: ReadonlySet<string>): string[] {
  if (raw.endsWith('.*')) {
    const prefix = raw.slice(0, -2);
    return [...allNamespaces].filter((namespace) => namespace === prefix || namespace.startsWith(prefix + '.'));
  }
  return allNamespaces.has(raw) ? [raw] : [];
}

/**
 * Extract the namespace from raw `.rosetta` source text. Returns `''` when no
 * `namespace` declaration is present (matching the historical callers).
 */
export function namespaceFromSource(text: string): string {
  return text.match(NAMESPACE_SOURCE_RE)?.[1] ?? '';
}

/**
 * Normalize a `RosettaModel.name` value (which may be a plain string, a quoted
 * STRING-named namespace, or a `{ segments: string[] }` qualified-name object)
 * to its dotted string form. Returns `undefined` for null/unknown shapes; the
 * caller supplies any `''`/`'unknown'` fallback it needs.
 */
export function namespaceFromModelName(name: unknown): string | undefined {
  if (typeof name === 'string') return name.replace(/^"|"$/g, '');
  if (name && typeof name === 'object' && 'segments' in name) {
    const segs = (name as { segments?: unknown }).segments;
    if (Array.isArray(segs)) return segs.join('.');
  }
  return undefined;
}
