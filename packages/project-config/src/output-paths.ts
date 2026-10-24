// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import type { BuildTarget, ProjectDiagnostic } from './types.js';
import { diagnostic } from './yaml-document.js';

/** A project-relative portable path; filesystem adapters must also check realpaths. */
export function normalizeProjectPath(input: string): string | undefined {
  const path = input.replaceAll('\\', '/');
  if (!path || path.startsWith('/') || /^[a-z]:/i.test(path) || path.includes('\0')) return undefined;
  const parts = path.split('/');
  if (parts.includes('..')) return undefined;
  const normalized = parts.filter((part) => part && part !== '.').join('/');
  return normalized || undefined;
}
function contains(parent: string, child: string): boolean {
  return child === parent || child.startsWith(parent + '/');
}
export function validateOutputPaths(
  targets: Record<string, BuildTarget>,
  protectedPaths: readonly string[]
): ProjectDiagnostic[] {
  const diagnostics: ProjectDiagnostic[] = [];
  const destinations: [string, string][] = [];
  const protectedRoots = ['.git', '.studio', ...protectedPaths]
    .map((path) => normalizeProjectPath(path.split(/[*?{[]/)[0] ?? path)?.toLowerCase())
    .filter((path): path is string => Boolean(path));
  for (const [name, target] of Object.entries(targets)) {
    const path = normalizeProjectPath(target.output)?.toLowerCase();
    const at = 'targets.' + name + '.output';
    if (!path) {
      diagnostics.push({
        ...diagnostic(at, 'OUTPUT_PATH', 'Choose a project-relative output directory without traversal.'),
        target: name
      });
      continue;
    }
    if (protectedRoots.some((root) => contains(root, path) || contains(path, root)))
      diagnostics.push({
        ...diagnostic(at, 'OUTPUT_PROTECTED', 'Output overlaps repository-managed or private files.'),
        target: name
      });
    for (const [peer, previous] of destinations)
      if (contains(previous, path) || contains(path, previous)) {
        diagnostics.push({
          ...diagnostic(at, 'OUTPUT_COLLISION', 'Output overlaps target ' + peer + '.'),
          target: name
        });
        diagnostics.push({
          ...diagnostic('targets.' + peer + '.output', 'OUTPUT_COLLISION', 'Output overlaps target ' + name + '.'),
          target: peer
        });
      }
    destinations.push([name, path]);
  }
  return diagnostics;
}
