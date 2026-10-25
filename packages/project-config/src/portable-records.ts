// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { z } from 'zod';
import { normalizeProjectPath } from './output-paths.js';
import type { ProjectDiagnostic, ProjectSnapshot } from './types.js';

export const PortableProjectPathSchema = z
  .string()
  .refine(
    (path) => normalizeProjectPath(path) === path && !/^(\.git|\.studio)(\/|$)/i.test(path),
    'Use a portable repository-relative path outside private storage.'
  );
export type PortableRecordRoot = 'examples' | 'workflows' | 'layouts';
export function portableRecordRoot(snapshot: ProjectSnapshot, kind: PortableRecordRoot): string | undefined {
  const root = normalizeProjectPath(snapshot.project.studio[kind]);
  return root && PortableProjectPathSchema.safeParse(root).success ? root : undefined;
}
/** Typed files only; malformed records are diagnosed while their original files remain intact. */
export function readPortableRecords<T>(
  snapshot: ProjectSnapshot,
  options: {
    root: PortableRecordRoot;
    extension: string;
    prefix: string;
    parse(value: unknown): T;
  }
): { documents: { path: string; value: T }[]; diagnostics: ProjectDiagnostic[] } {
  const documents: { path: string; value: T }[] = [];
  const diagnostics: ProjectDiagnostic[] = [];
  const root = portableRecordRoot(snapshot, options.root);
  if (!root)
    return {
      documents,
      diagnostics: [
        {
          code: options.prefix + '_ROOT_INVALID',
          severity: 'error',
          path: 'studio-config.yml',
          message: 'Configure a portable directory outside private storage.'
        }
      ]
    };
  for (const path of [...snapshot.files.keys()].sort()) {
    if (!path.startsWith(root + '/') || !path.endsWith(options.extension)) continue;
    try {
      documents.push({ path, value: options.parse(JSON.parse(snapshot.files.get(path)!)) });
    } catch {
      diagnostics.push({
        code: options.prefix + '_DESCRIPTOR_INVALID',
        severity: 'error',
        path,
        message: 'This typed descriptor is invalid. Its original file is retained.'
      });
    }
  }
  return { documents, diagnostics };
}
