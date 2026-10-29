// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/** Shared linked-type traversal; generated views use this same algorithm. */
export function runeDeepPaths<Type, Field>(
  type: Type | undefined,
  fields: (type: Type) => readonly Field[],
  child: (field: Field) => Type | undefined,
  matches: (field: Field) => boolean,
  key: (field: Field) => string,
  seen = new Set<Type>()
): Field[][] {
  if (type === undefined || seen.has(type)) return [];
  const own = fields(type);
  const direct = own.filter(matches);
  if (direct.length) return direct.map((field) => [field]);
  const next = new Set(seen).add(type);
  const paths = own.flatMap((field) =>
    runeDeepPaths(child(field), fields, child, matches, key, next).map((path) => [field, ...path])
  );
  return [...new Map(paths.map((path) => [path.map(key).join('\u0000'), path])).values()];
}
