// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { expandNamespaceWildcard, BASE_TYPE_FILES, namespaceFromSource } from '@rune-langium/core';
import { validateTargetOptions, type GeneratorOutput } from '@rune-langium/codegen/export';
import {
  normalizeProjectPath,
  projectDiagnosticsForTargets,
  readProjectFiles,
  createProjectSnapshot,
  type BuildTarget,
  type ProjectSnapshot,
  type ProjectDiagnostic,
  type ProjectFileAdapter,
  type TargetValidator
} from '@rune-langium/project-config';
export type ProjectGeneratedFile = Pick<GeneratorOutput, 'relativePath' | 'content' | 'binary' | 'diagnostics'>;
export type ProjectTargetGenerator = (
  snapshot: ProjectSnapshot,
  target: BuildTarget,
  name: string
) => Promise<readonly ProjectGeneratedFile[]>;
export { PROJECT_TOOLCHAIN } from './toolchain.js';
import { projectToolchainDiagnostics } from './toolchain.js';
import { createProjectReceipt, projectReceiptMatches, type EffectiveProjectReceipt } from './project-receipt.js';
export * from './project-receipt.js';
export const validateProjectTarget: TargetValidator = (target) =>
  validateTargetOptions(target.generator, target.options).errors.map((message) => ({
    code: 'TARGET_OPTIONS',
    severity: 'error',
    path: 'targets',
    message
  }));
export interface ProjectBuildResult {
  status: 'success' | 'failed';
  diagnostics: ProjectDiagnostic[];
  outputs: readonly string[];
}
const error = (code: string, path: string, message: string, target?: string): ProjectDiagnostic => ({
  code,
  path,
  message,
  severity: 'error',
  ...(target ? { target } : {})
});

/** Validate every selected target and stage generation before writing any output. */
export async function runProjectBuild(
  snapshot: ProjectSnapshot,
  request: { targets: readonly string[] | 'all'; signal?: AbortSignal; projectReceipt?: EffectiveProjectReceipt },
  adapter: ProjectFileAdapter,
  generateTarget: ProjectTargetGenerator
): Promise<ProjectBuildResult> {
  const diagnostics: ProjectDiagnostic[] = [];
  const outputs: string[] = [];
  try {
    const current = await readProjectFiles(adapter);
    const captured = await createProjectSnapshot(
      snapshot.workspaceId,
      current.files,
      validateProjectTarget,
      current.revisions
    );
    await current.verify();
    if (captured.revision !== snapshot.revision)
      return {
        status: 'failed',
        outputs,
        diagnostics: [error('PROJECT_STALE', '', 'Project files changed; reload before building.')]
      };
    const targets = captured.project.build.targets;
    const names = request.targets === 'all' ? Object.keys(targets) : [...new Set(request.targets)];
    if (!names.length)
      diagnostics.push(error('TARGET_REQUIRED', 'targets', 'Select one or more named targets, or Build all.'));
    for (const name of names)
      if (!Object.hasOwn(targets, name))
        diagnostics.push(error('TARGET_UNKNOWN', 'targets.' + name, 'Unknown target: ' + name, name));
    diagnostics.push(...projectDiagnosticsForTargets(captured.project.diagnostics, names));
    diagnostics.push(...projectToolchainDiagnostics(captured.lock?.toolchain ?? {}));
    const resolved = projectReceiptMatches(await createProjectReceipt(captured), request.projectReceipt);
    if (Object.keys(captured.project.build.references).length && !resolved)
      diagnostics.push(
        error(
          'REFERENCE_UNRESOLVED',
          'references',
          'Resolve and verify reference releases before building this project.'
        )
      );
    if (captured.project.build.overrides?.length && !resolved)
      diagnostics.push(
        error('OVERRIDE_UNRESOLVED', 'overrides', 'Resolve explicit project overrides before building.')
      );
    if (captured.project.build.overrides?.length && names.some((name) => targets[name]?.generator === 'rosetta'))
      diagnostics.push(
        error(
          'SOURCE_MATERIALIZATION_UNAVAILABLE',
          'targets',
          'Standalone Rune export cannot materialize explicit project overrides. Export the portable project instead.'
        )
      );
    const model = captured.project.rune.model as Record<string, unknown> | undefined;
    if (model?.enableExperimentalFeatures)
      diagnostics.push(
        error(
          'RUNE_SETTING_UNSUPPORTED',
          'model.enableExperimentalFeatures',
          'This project host has no experimental-feature compatibility adapter.'
        )
      );
    const defaults = captured.project.rune.generators as Record<string, unknown> | undefined;
    if (defaults?.doNotPrune !== undefined && (!Array.isArray(defaults.doNotPrune) || defaults.doNotPrune.length))
      diagnostics.push(
        error(
          'RUNE_SETTING_UNSUPPORTED',
          'generators.doNotPrune',
          'Configured builder-pruning behavior is not supported by these generators.'
        )
      );
    if (diagnostics.some((issue) => issue.severity === 'error')) return { status: 'failed', diagnostics, outputs };
    const staged: { path: string; content: string; binary?: Uint8Array }[] = [];
    for (const name of names) {
      request.signal?.throwIfAborted();
      const target = targets[name]!;
      const generated = await generateTarget(captured, target, name);
      for (const file of generated) {
        const relative = normalizeProjectPath(file.relativePath);
        if (!relative) throw new Error('Generator returned an unsafe output path.');
        if (file.binary && !adapter.writeBinary)
          return {
            status: 'failed',
            outputs,
            diagnostics: [
              ...diagnostics,
              error(
                'BINARY_OUTPUT_UNAVAILABLE',
                'targets.' + name,
                'This backing does not support binary output.',
                name
              )
            ]
          };
        staged.push({
          path: normalizeProjectPath(target.output)! + '/' + relative,
          content: file.content,
          ...(file.binary ? { binary: file.binary } : {})
        });
        diagnostics.push(
          ...file.diagnostics.map((issue) => ({
            code: issue.code ?? 'GENERATOR',
            severity: issue.severity === 'error' ? ('error' as const) : ('warning' as const),
            path: relative,
            message: issue.message,
            target: name
          }))
        );
      }
    }
    if (diagnostics.some((issue) => issue.severity === 'error')) return { status: 'failed', diagnostics, outputs };
    request.signal?.throwIfAborted();
    await current.verify();
    const expected = new Map<string, string | null>();
    for (const file of staged) expected.set(file.path, (await adapter.read(file.path))?.revision ?? null);
    for (const file of staged) {
      request.signal?.throwIfAborted();
      const revision = expected.get(file.path)!;
      if (file.binary) await adapter.writeBinary!(file.path, file.binary, revision);
      else await adapter.write(file.path, file.content, revision);
      outputs.push(file.path);
    }
    return { status: 'success', diagnostics, outputs };
  } catch (failure) {
    diagnostics.push(error('BUILD_FAILED', '', failure instanceof Error ? failure.message : 'Project build failed.'));
    return { status: 'failed', diagnostics, outputs };
  }
}

/** Concrete scopes shared by the native parser host and Studio's network generator. */
export function projectTargetNamespaces(
  snapshot: ProjectSnapshot,
  target: BuildTarget,
  sourceNamespaces: ReadonlySet<string>
): string[] {
  const configured =
    target.namespaces ?? (snapshot.project.rune.generators as Record<string, unknown> | undefined)?.namespaces;
  if (
    configured !== undefined &&
    (!Array.isArray(configured) || !configured.every((value) => typeof value === 'string'))
  )
    throw new Error('Namespace defaults must be a list of namespace names.');
  if (!configured?.length) return [...sourceNamespaces];
  const known = new Set([...sourceNamespaces, ...BASE_TYPE_FILES.map((file) => namespaceFromSource(file.content))]);
  return [
    ...new Set(
      (configured as string[]).flatMap((pattern) => {
        const matches = expandNamespaceWildcard(pattern, known);
        if (!matches.length) throw new Error('Unknown namespace scope: ' + pattern);
        return matches.filter((name) => sourceNamespaces.has(name));
      })
    )
  ];
}
