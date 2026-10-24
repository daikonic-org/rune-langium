// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import type { ProjectResolutionContext } from '../references/project-contract.js';
import { namespaceFromModelName } from '../naming/namespace.js';

/** Incremental semantic documents followed by the complete current URI set. */
export interface LspModelUpdate {
  resolution?: ProjectResolutionContext | null;
  document?: { uri: string; modelJson: string };
  retain?: string[];
}

export const LSP_MODEL_SYNC_METHOD = 'rune/syncModels';

/** Request budget includes reconstruction of dependency models after cold wake. */
export const LSP_REQUEST_TIMEOUT_MS = 30_000;

/** Keep semantic AST data and declaration ranges, without dependency token spans. */
export function compactLspModelJson(json: string): string {
  return JSON.stringify(JSON.parse(json), function (key, value) {
    if (key === '$cstText' || key === '$sourceText') return undefined;
    if (key !== '$textRegion') return value;
    if (typeof this.name !== 'string') return undefined;
    const { assignments, ...region } = value;
    return { ...region, assignments: assignments?.name ? { name: assignments.name } : {} };
  });
}

/** Read canonical import and resolved-reference edges, including function bodies. */
export function readLspModelMetadata(json: string): {
  namespace?: string;
  sourceUri?: string;
  imports: string[];
  references: string[];
} {
  const references = new Set<string>();
  const model = JSON.parse(json, (key, value) => {
    const targets = key === '$ref' ? [value] : key === '$refs' && Array.isArray(value) ? value : [];
    for (const target of targets) {
      if (typeof target === 'string' && !target.startsWith('#')) references.add(target.split('#')[0]!);
    }
    return value;
  });
  return {
    namespace: namespaceFromModelName(model.name),
    sourceUri: model.$textRegion?.documentURI,
    imports: (model.imports ?? []).map((entry: { importedNamespace: string }) => entry.importedNamespace),
    references: [...references]
  };
}
