// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { normalizeProjectPath, type ProjectSnapshot, type ProjectDiagnostic } from '@rune-langium/project-config';
export interface ProjectResourceIdentity {
  model: string;
  id: string;
}
export function resolveProjectResource(
  snapshot: ProjectSnapshot,
  source: ProjectResourceIdentity
): { path: string; checksum?: string } | ProjectDiagnostic {
  const mappings = (snapshot.project.build.overrides ?? []).filter(
    (mapping) => mapping.kind === 'resource' && mapping.source.model === source.model && mapping.source.id === source.id
  );
  const fail = (message: string): ProjectDiagnostic => ({
    code: 'RESOURCE_UNAVAILABLE',
    severity: 'error',
    path: 'overrides',
    message
  });
  if (mappings.length !== 1 || mappings[0]?.kind !== 'resource')
    return fail('One explicit resource mapping is required for ' + source.model + ':' + source.id);
  const path = normalizeProjectPath(mappings[0].path);
  if (
    !path ||
    !snapshot.project.build.resources.some((root) => {
      const base = normalizeProjectPath(root.path);
      return base && (path === base || path.startsWith(base + '/'));
    })
  )
    return fail('Mapped resource must be inside a configured resource root.');
  const checksum = snapshot.fileRevisions.get(path);
  if (!snapshot.files.has(path) || !checksum) return fail('Mapped resource is missing: ' + path);
  return { path, checksum };
}
