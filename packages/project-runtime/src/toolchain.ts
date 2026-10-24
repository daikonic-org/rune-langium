// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { valid, satisfies } from 'semver';
import corePackage from '@rune-langium/core/package.json' with { type: 'json' };
import codegenPackage from '@rune-langium/codegen/package.json' with { type: 'json' };
import type { ProjectDiagnostic } from '@rune-langium/project-config';
export const PROJECT_TOOLCHAIN: Readonly<Record<string, string>> = {
  '@rune-langium/core': corePackage.version,
  '@rune-langium/codegen': codegenPackage.version
};
/** Exact installed tool packages; serialized Langium format must satisfy core's declared support range. */
export function projectToolchainDiagnostics(
  toolchain: Readonly<Record<string, string>>,
  complete = false
): ProjectDiagnostic[] {
  const errors: ProjectDiagnostic[] = [];
  const invalid = (id: string, version: string) =>
    errors.push({
      code: 'TOOLCHAIN_MISMATCH',
      severity: 'error',
      path: 'build-config.lock.json',
      message: 'Locked toolchain is unavailable: ' + id + '@' + version
    });
  for (const [id, version] of Object.entries(toolchain)) {
    if (
      id === 'langium'
        ? !valid(version) || !satisfies(version, corePackage.dependencies.langium)
        : PROJECT_TOOLCHAIN[id] !== version
    )
      invalid(id, version);
  }
  if (complete)
    for (const id of [...Object.keys(PROJECT_TOOLCHAIN), 'langium'])
      if (!Object.hasOwn(toolchain, id)) invalid(id, 'missing');
  return errors;
}
