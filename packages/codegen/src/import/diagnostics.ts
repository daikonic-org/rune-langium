// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Untranslatable-construct reporting for the inbound pipeline. Mirrors the
 * outbound `../diagnostics.ts` convention (`GeneratorDiagnostic` shape) —
 * kept as a separate type/module per spec.md's module structure, since the
 * inbound pipeline reports at IMPORT time (before any Rune AST exists),
 * whereas outbound diagnostics are attached to a `GeneratorOutput`.
 */

export interface ImportDiagnosticOpts {
  sourceKey?: string;
}

/** A diagnostic raised while importing a source model. */
export interface ImportDiagnostic {
  severity: 'error' | 'warning' | 'info';
  /** Short diagnostic code (e.g. 'untranslatable-construct', 'unresolved-ref', 'external-ref'). */
  code: string;
  message: string;
  /** Original source-format key (JSON pointer, property path, etc.), when known. */
  sourceKey?: string;
}

export function pushDiagnostic(
  diagnostics: ImportDiagnostic[],
  diagnostic: Omit<ImportDiagnostic, 'sourceKey'>,
  opts?: ImportDiagnosticOpts
): void {
  diagnostics.push({
    ...diagnostic,
    ...(opts?.sourceKey !== undefined && { sourceKey: opts.sourceKey })
  });
}
