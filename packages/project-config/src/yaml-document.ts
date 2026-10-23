// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { isAlias, isMap, parseDocument, visit } from 'yaml';
import type { ConfigDocument, ProjectDiagnostic } from './types.js';
export function diagnostic(path: string, code: string, message: string): ProjectDiagnostic {
  return { path, code, message, severity: 'error' };
}
/** One duplicate/alias policy applies to companion and upstream configuration. */
export function readYaml(source: ConfigDocument) {
  const document = parseDocument(source.text, { uniqueKeys: true, prettyErrors: false });
  const diagnostics: ProjectDiagnostic[] = document.errors.map((error) =>
    diagnostic(source.path, error.code === 'DUPLICATE_KEY' ? 'CONFIG_DUPLICATE_KEY' : 'CONFIG_SYNTAX', error.message)
  );
  visit(document, {
    Node(_key, node) {
      if (isAlias(node))
        diagnostics.push(
          diagnostic(source.path, 'CONFIG_ALIAS', 'Configuration aliases are not supported. Use explicit values.')
        );
      if (isMap(node) && node.items.some((pair) => String(pair.key) === '<<'))
        diagnostics.push(
          diagnostic(source.path, 'CONFIG_ALIAS', 'Configuration merge keys are not supported. Use explicit values.')
        );
    }
  });
  return { document, diagnostics };
}
export function discoverDocument(
  files: ReadonlyMap<string, string>,
  base: string
): { document?: ConfigDocument; diagnostics: ProjectDiagnostic[] } {
  const candidates = [base + '.yml', base + '.yaml'].filter((path) => files.has(path));
  if (candidates.length > 1)
    return {
      diagnostics: [
        diagnostic(base, 'CONFIG_AMBIGUOUS', 'Keep only one configuration spelling: ' + candidates.join(', ') + '.')
      ]
    };
  const path = candidates[0];
  return { document: path ? { path, text: files.get(path)! } : undefined, diagnostics: [] };
}
