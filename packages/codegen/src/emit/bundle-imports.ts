// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { RUNE_HELPER_NAMES } from '../helpers.js';
import { resolveImportPath, type NamespaceRegistry } from './namespace-registry.js';

/** Bundled declarations share a module, so their original relative imports disappear. */
export function stripBundledImports(
  content: string,
  fromPath: string,
  bundledPaths: readonly string[],
  extension: '.ts' | '.zod.ts'
): string {
  const namespace = (path: string) => path.slice(0, -extension.length).replace(/\//g, '.');
  const registry: NamespaceRegistry = { namespaces: new Map() };
  const imports = new Set(
    bundledPaths.map(
      (path) =>
        `${resolveImportPath(namespace(fromPath), namespace(path), registry)}${extension.replace(/\.ts$/, '.js')}`
    )
  );
  return content
    .split('\n')
    .filter((line) => {
      const match = /^import .* from ['"]([^'"]+)['"];$/.exec(line);
      return !match || !imports.has(match[1]!);
    })
    .join('\n');
}

/** Strip the generated preamble through the runtime-helper import; preserve unrecognized input. */
export function stripPerNamespaceHeader(content: string): string {
  const lines = content.split('\n');
  let bodyStart = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]?.startsWith(`import { ${RUNE_HELPER_NAMES[0]},`)) {
      bodyStart = i + 1;
      if (bodyStart < lines.length && lines[bodyStart] === '') bodyStart += 1;
      break;
    }
  }
  if (bodyStart === 0) return content;
  return lines.slice(bodyStart).join('\n').trimEnd();
}
