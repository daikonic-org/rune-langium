// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { BuildConfigSchema, StudioConfigSchema } from './config-schema.js';
import { discoverProjectConfig, parseBuildConfig, parseStudioConfig } from './config-codec.js';
import { diagnostic, discoverDocument, readYaml } from './yaml-document.js';
import type { NormalizedProject, ProjectDiagnostic, ProjectFiles, TargetValidator } from './types.js';
export function mergeNamespaceConfig(
  dependencies: readonly Record<string, unknown>[],
  project: readonly Record<string, unknown>[]
): Record<string, unknown>[] {
  const result = dependencies.map((entry) => ({ ...entry }));
  for (const entry of project) {
    const index = typeof entry.id === 'string' ? result.findIndex((previous) => previous.id === entry.id) : -1;
    if (index >= 0) result[index] = { ...entry };
    else result.push({ ...entry });
  }
  return result;
}
export function normalizeProject(files: ProjectFiles, validateTarget: TargetValidator): NormalizedProject {
  const discovery = discoverProjectConfig(files);
  const build = discovery.build
    ? parseBuildConfig(discovery.build)
    : { value: BuildConfigSchema.parse({ schemaVersion: 1 }), diagnostics: [] };
  const studio = discovery.studio
    ? parseStudioConfig(discovery.studio)
    : { value: StudioConfigSchema.parse({ schemaVersion: 1 }), diagnostics: [] };
  const diagnostics: ProjectDiagnostic[] = [...discovery.diagnostics, ...build.diagnostics, ...studio.diagnostics];
  const effectiveBuild = build.value ?? BuildConfigSchema.parse({ schemaVersion: 1 });
  let rune: Record<string, unknown> = {};
  let runeSource = files.has(effectiveBuild.runeConfig)
    ? { path: effectiveBuild.runeConfig, text: files.get(effectiveBuild.runeConfig)! }
    : undefined;
  if (effectiveBuild.runeConfig === 'rune-config.yml') {
    const found = discoverDocument(files, 'rune-config');
    diagnostics.push(...found.diagnostics);
    runeSource = found.document;
  }
  if (runeSource) {
    const parsed = readYaml(runeSource);
    diagnostics.push(...parsed.diagnostics);
    if (!parsed.diagnostics.length) {
      const value: unknown = parsed.document.toJS({ maxAliasCount: 0 });
      if (value && typeof value === 'object' && !Array.isArray(value)) rune = value as Record<string, unknown>;
      else diagnostics.push(diagnostic(runeSource.path, 'CONFIG_SCHEMA', 'Rune configuration must be an object.'));
    }
  } else if (discovery.build)
    diagnostics.push(
      diagnostic(
        effectiveBuild.runeConfig,
        'RUNE_CONFIG_MISSING',
        'The configured Rune model settings file is missing.'
      )
    );
  for (const [name, target] of Object.entries(effectiveBuild.targets))
    diagnostics.push(...validateTarget(target).map((issue) => ({ ...issue, target: name })));
  return {
    build: effectiveBuild,
    studio: studio.value ?? StudioConfigSchema.parse({ schemaVersion: 1 }),
    rune,
    diagnostics
  };
}
