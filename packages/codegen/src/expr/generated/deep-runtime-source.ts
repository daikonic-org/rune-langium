// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
// Generated from ../deep-paths.ts; do not edit.

export const DEEP_RUNTIME_SOURCE =
  "// SPDX-License-Identifier: MIT\n// Copyright (c) 2026 Pradeep Mouli\n\n/** Shared linked-type traversal; generated views use this same algorithm. */\nfunction runeDeepPaths<Type, Field>(\n  type: Type | undefined,\n  fields: (type: Type) => readonly Field[],\n  child: (field: Field) => Type | undefined,\n  matches: (field: Field) => boolean,\n  key: (field: Field) => string,\n  seen = new Set<Type>()\n): Field[][] {\n  if (type === undefined || seen.has(type)) return [];\n  const own = fields(type);\n  const direct = own.filter(matches);\n  if (direct.length) return direct.map((field) => [field]);\n  const next = new Set(seen).add(type);\n  const paths = own.flatMap((field) =>\n    runeDeepPaths(child(field), fields, child, matches, key, next).map((path) => [field, ...path])\n  );\n  return [...new Map(paths.map((path) => [path.map(key).join('\\u0000'), path])).values()];\n}\n";
