// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import {
  parseProjectImportReport,
  projectDiagnosticsForTargets,
  type ProjectSnapshot,
  type ProjectImportReport,
  type ProjectDiagnostic
} from '@rune-langium/project-config';
import type { Capability } from '../capabilities.js';
export interface ProjectInitializationStatus {
  report?: ProjectImportReport;
  reportDiagnostics: readonly ProjectDiagnostic[];
  targets: { name: string; status: 'configured' | 'unavailable'; reasons: string[] }[];
  functions: readonly Capability[];
}
/** Persisted import evidence is historical; current diagnostics/capabilities determine availability. */
export function projectInitializationStatus(
  snapshot: ProjectSnapshot,
  capabilities: readonly Capability[],
  diagnostics: readonly ProjectDiagnostic[] = snapshot.project.diagnostics
): ProjectInitializationStatus {
  const path = snapshot.project.build.importReport;
  const text = path && snapshot.files.get(path);
  const report = !path
    ? { diagnostics: [] }
    : text === undefined
      ? {
          diagnostics: [
            {
              code: 'IMPORT_REPORT_MISSING',
              severity: 'warning' as const,
              path,
              message: 'The saved initialization report is missing. Restore it to review the original import evidence.'
            }
          ]
        }
      : parseProjectImportReport({ path, text });
  return {
    ...('value' in report && report.value ? { report: report.value } : {}),
    reportDiagnostics: report.diagnostics,
    targets: Object.keys(snapshot.project.build.targets).map((name) => {
      const reasons = [
        ...new Set([
          ...projectDiagnosticsForTargets(diagnostics, [name])
            .filter((issue) => issue.severity === 'error')
            .map((issue) => issue.message),
          ...capabilities
            .filter((capability) => capability.status === 'unavailable' && capability.affectedTargets.includes(name))
            .map((capability) => capability.reason ?? capability.id)
        ])
      ];
      return { name, status: reasons.length ? 'unavailable' : 'configured', reasons };
    }),
    functions: capabilities.filter((capability) => capability.affectedFunctions.length > 0)
  };
}
