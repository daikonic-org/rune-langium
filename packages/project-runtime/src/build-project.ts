// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import {
  createRuneDslServices,
  assertValidDocuments,
  namespaceFromModelName,
  type RosettaModel
} from '@rune-langium/core';
import {
  generateSelected,
  validateTargetOptions,
  type GeneratorOptions,
  type Target
} from '@rune-langium/codegen/export';
import { URI, type LangiumDocument } from 'langium';
import { projectSourcePaths, type ProjectSnapshot, type ProjectFileAdapter } from '@rune-langium/project-config';

/** Isolated services keep unrelated project versions out of each other's index. */
export async function createProjectGraph(snapshot: ProjectSnapshot): Promise<LangiumDocument<RosettaModel>[]> {
  const sourceFiles = projectSourcePaths(snapshot.files, snapshot.project.build.sources).map(
    (path) => [path, snapshot.files.get(path)!] as const
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

export { PROJECT_TOOLCHAIN, validateProjectTarget, type ProjectBuildResult } from './project-build.js';
import { projectTargetNamespaces, runProjectBuild } from './project-build.js';

/** Native parser host for the same staged build transaction used by Studio. */
export async function buildProject(
  snapshot: ProjectSnapshot,
  request: { targets: readonly string[] | 'all' },
  adapter: ProjectFileAdapter
) {
  let documents: LangiumDocument<RosettaModel>[] | undefined;
  return runProjectBuild(snapshot, request, adapter, async (captured, target) => {
    documents ??= await createProjectGraph(captured);
    const validated = validateTargetOptions(target.generator, target.options);
    const namespaces = projectTargetNamespaces(
      captured,
      target,
      new Set(
        documents
          .map((document) => namespaceFromModelName(document.parseResult.value.name))
          .filter((name): name is string => Boolean(name))
      )
    );
    const options: GeneratorOptions = {
      target: target.generator as Target,
      strict: true,
      [target.generator]: validated.value
    };
    return (await generateSelected(documents, { namespaces, declarations: [] }, options)).outputs;
  });
}
