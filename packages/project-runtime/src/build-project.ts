// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import {
  createRuneDslServices,
  assertValidDocuments,
  expandNamespaceWildcard,
  BASE_TYPE_FILES,
  namespaceFromSource,
  namespaceFromModelName,
  type RosettaModel
} from '@rune-langium/core';
import {
  generateSelected,
  validateTargetOptions,
  type GeneratorOptions,
  type Target
} from '@rune-langium/codegen/export';
import corePackage from '@rune-langium/core/package.json' with { type: 'json' };
import codegenPackage from '@rune-langium/codegen/package.json' with { type: 'json' };
import { URI, type LangiumDocument } from 'langium';
import picomatch from 'picomatch';
import {
  normalizeProjectPath,
  projectDiagnosticsForTargets,
  readProjectFiles,
  createProjectSnapshot,
  type ProjectSnapshot,
  type ProjectDiagnostic,
  type ProjectFileAdapter,
  type TargetValidator
} from '@rune-langium/project-config';

export const PROJECT_TOOLCHAIN: Readonly<Record<string, string>> = {
  '@rune-langium/core': corePackage.version,
  '@rune-langium/codegen': codegenPackage.version
};
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

/** Isolated services keep unrelated project versions out of each other's index. */
export async function createProjectGraph(snapshot: ProjectSnapshot): Promise<LangiumDocument<RosettaModel>[]> {
  const patterns = snapshot.project.build.sources.map((pattern) => {
    const normalized = normalizeProjectPath(pattern);
    if (!normalized || normalized.startsWith('!'))
      throw new Error('Source patterns must be relative positive globs: ' + pattern);
    return picomatch(normalized, { windows: false, dot: true });
  });
  const sourceFiles = [...snapshot.files].filter(
    ([path]) => path.endsWith('.rosetta') && patterns.some((match) => match(path))
  );
  if (!sourceFiles.length) throw new Error('No .rosetta sources match the configured source patterns.');
  const { RuneDsl, shared } = createRuneDslServices();
  await shared.workspace.WorkspaceManager.initializeWorkspace([]);
  const documents = sourceFiles.map(([path, text]) =>
    shared.workspace.LangiumDocumentFactory.fromString<RosettaModel>(
      text,
      URI.parse(
        'inmemory:///project/' +
          encodeURIComponent(snapshot.workspaceId) +
          '/' +
          path.split('/').map(encodeURIComponent).join('/')
      )
    )
  );
  for (const document of documents) shared.workspace.LangiumDocuments.addDocument(document);
  await RuneDsl.shared.workspace.DocumentBuilder.build(documents, { validation: true });
  assertValidDocuments(documents);
  const invalid = documents.flatMap((document) =>
    (document.diagnostics ?? [])
      .filter((diagnostic) => diagnostic.severity === 1)
      .map((diagnostic) => document.uri + ': ' + diagnostic.message)
  );
  if (invalid.length) throw new Error(invalid.join('\n'));
  return documents;
}

/** Validate every selected target and stage generation before writing any output. */
export async function buildProject(
  snapshot: ProjectSnapshot,
  request: { targets: readonly string[] | 'all' },
  adapter: ProjectFileAdapter
): Promise<ProjectBuildResult> {
  const diagnostics: ProjectDiagnostic[] = [];
  const outputs: string[] = [];
  try {
    const current = await readProjectFiles(adapter);
    const captured = await createProjectSnapshot(snapshot.workspaceId, current.files, validateProjectTarget);
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
    for (const [id, version] of Object.entries(captured.lock?.toolchain ?? {}))
      if (PROJECT_TOOLCHAIN[id] !== version)
        diagnostics.push(
          error(
            'TOOLCHAIN_MISMATCH',
            'build-config.lock.json',
            'Locked toolchain is unavailable: ' + id + '@' + version
          )
        );
    if (Object.keys(captured.project.build.references).length)
      diagnostics.push(
        error(
          'REFERENCE_UNRESOLVED',
          'references',
          'Resolve and verify reference releases before building this project.'
        )
      );
    if (captured.project.build.overrides?.length)
      diagnostics.push(
        error('OVERRIDE_UNRESOLVED', 'overrides', 'Resolve explicit project overrides before building.')
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
    const documents = await createProjectGraph(captured);
    const staged: { path: string; content: string; binary?: Uint8Array }[] = [];
    for (const name of names) {
      const target = targets[name]!;
      const validated = validateTargetOptions(target.generator, target.options);
      const configuredNamespaces = target.namespaces ?? defaults?.namespaces;
      if (
        configuredNamespaces !== undefined &&
        (!Array.isArray(configuredNamespaces) || !configuredNamespaces.every((value) => typeof value === 'string'))
      )
        return {
          status: 'failed',
          outputs,
          diagnostics: [
            ...diagnostics,
            error(
              'RUNE_SETTING_UNSUPPORTED',
              'generators.namespaces',
              'Namespace defaults must be a list of namespace names.',
              name
            )
          ]
        };
      const sourceNamespaces = new Set(
        documents
          .map((document) => namespaceFromModelName(document.parseResult.value.name))
          .filter((name): name is string => Boolean(name))
      );
      const knownNamespaces = new Set([
        ...sourceNamespaces,
        ...BASE_TYPE_FILES.map((file) => namespaceFromSource(file.content))
      ]);
      const namespaces = configuredNamespaces?.length
        ? [
            ...new Set(
              (configuredNamespaces as string[]).flatMap((pattern) => {
                const matches = expandNamespaceWildcard(pattern, knownNamespaces);
                if (!matches.length) throw new Error('Unknown namespace scope: ' + pattern);
                return matches.filter((name) => sourceNamespaces.has(name));
              })
            )
          ]
        : [...sourceNamespaces];
      const options: GeneratorOptions = {
        target: target.generator as Target,
        strict: true,
        [target.generator]: validated.value
      };
      const generated = await generateSelected(documents, { namespaces, declarations: [] }, options);
      for (const file of generated.outputs) {
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
          path: target.output.replaceAll('\\', '/') + '/' + relative,
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
    await current.verify();
    const expected = new Map<string, string | null>();
    for (const file of staged) expected.set(file.path, (await adapter.read(file.path))?.revision ?? null);
    for (const file of staged) {
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
