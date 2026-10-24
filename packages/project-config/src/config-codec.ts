// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { isMap, isScalar } from 'yaml';
import type { Document } from 'yaml';
import type { z } from 'zod';
import { BuildConfigSchema, StudioConfigSchema, ProjectLockSchema } from './config-schema.js';
import { diagnostic, discoverDocument, readYaml } from './yaml-document.js';
import type { BuildConfig, ConfigDocument, ConfigResult, ProjectFiles, ProjectLock, StudioConfig } from './types.js';
export function discoverProjectConfig(files: ProjectFiles) {
  const build = discoverDocument(files, 'build-config');
  const studio = discoverDocument(files, 'studio-config');
  return { build: build.document, studio: studio.document, diagnostics: [...build.diagnostics, ...studio.diagnostics] };
}
function parseConfig<T>(source: ConfigDocument, schema: z.ZodType<T>): ConfigResult<T> {
  const parsed = readYaml(source);
  if (parsed.diagnostics.length) return { diagnostics: parsed.diagnostics };
  const result = schema.safeParse(parsed.document.toJS({ maxAliasCount: 0 }));
  return result.success
    ? { value: result.data, diagnostics: [] }
    : {
        diagnostics: result.error.issues.map((issue) =>
          diagnostic(source.path, 'CONFIG_SCHEMA', (issue.path.join('.') || 'config') + ': ' + issue.message)
        )
      };
}
export function parseBuildConfig(source: ConfigDocument): ConfigResult<BuildConfig> {
  return parseConfig(source, BuildConfigSchema);
}
export function parseStudioConfig(source: ConfigDocument): ConfigResult<StudioConfig> {
  return parseConfig(source, StudioConfigSchema);
}
/** Dynamic record keys express user edits; unknown schema properties survive. */
function replaceMapEntries(document: Document.Parsed, path: string[], previous: unknown, next: unknown): void {
  const current = document.getIn(path, true);
  if (next !== null && typeof next === 'object' && !Array.isArray(next) && isMap(current)) {
    const values = next as Record<string, unknown>;
    const known =
      previous && typeof previous === 'object' && !Array.isArray(previous) ? (previous as Record<string, unknown>) : {};
    for (const key of Object.keys(known)) if (!Object.hasOwn(values, key)) document.deleteIn([...path, key]);
    for (const [key, value] of Object.entries(values)) replaceMapEntries(document, [...path, key], known[key], value);
    return;
  }
  if (JSON.stringify(document.getIn(path)) === JSON.stringify(next)) return;
  if (isScalar(current) && (next === null || typeof next !== 'object')) current.value = next;
  else document.setIn(path, next);
}
function updateConfig<T extends object>(source: ConfigDocument, next: T, schema: z.ZodType<T>): string {
  const parsed = readYaml(source);
  if (parsed.diagnostics.length) throw new Error('Cannot update invalid configuration: ' + source.path);
  const original = schema.safeParse(parsed.document.toJS({ maxAliasCount: 0 }));
  if (!original.success) throw new Error('Cannot update invalid configuration: ' + source.path);
  const checked = schema.parse(next);
  for (const key of Object.keys(original.data)) if (!Object.hasOwn(checked, key)) parsed.document.delete(key);
  for (const [key, value] of Object.entries(checked))
    replaceMapEntries(parsed.document, [key], Reflect.get(original.data, key), value);
  return parsed.document.toString();
}
export function updateBuildConfig(source: ConfigDocument, next: BuildConfig): string {
  return updateConfig(source, next, BuildConfigSchema);
}
export function updateStudioConfig(source: ConfigDocument, next: StudioConfig): string {
  return updateConfig(source, next, StudioConfigSchema);
}
export function parseProjectLock(source: ConfigDocument): ConfigResult<ProjectLock> {
  let input: unknown;
  try {
    input = JSON.parse(source.text);
  } catch {
    return { diagnostics: [diagnostic(source.path, 'CONFIG_SYNTAX', 'Invalid dependency lock JSON.')] };
  }
  const result = ProjectLockSchema.safeParse(input);
  return result.success
    ? { value: result.data, diagnostics: [] }
    : {
        diagnostics: result.error.issues.map((issue) =>
          diagnostic(source.path, 'CONFIG_SCHEMA', issue.path.join('.') + ': ' + issue.message)
        )
      };
}
