// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { namespaceFromModelName, type RosettaModel } from '@rune-langium/core';
import {
  generateSelected,
  validateTargetOptions,
  type GeneratorOptions,
  type Target
} from '@rune-langium/codegen/export';
import { type LangiumDocument } from 'langium';
import {
  projectDiagnosticsForTargets,
  type ProjectSnapshot,
  type ProjectFileAdapter
} from '@rune-langium/project-config';

import type { ImplementationProvider } from './implementations.js';
import { assertProjectGenerationCapabilities } from './capability-impact.js';
import { buildEffectiveProject } from './effective-project.js';
import {
  loadProjectReferences,
  createReferenceTransport,
  createMemoryReferenceCache,
  type ReferenceDocument,
  type ReferenceTransport,
  type ReferenceCache
} from './references/index.js';

/** Local graph construction reuses the same authoritative project composition as reference builds. */
export async function createProjectGraph(
  snapshot: ProjectSnapshot,
  references: readonly ReferenceDocument[] = []
): Promise<LangiumDocument<RosettaModel>[]> {
  const graph = await buildEffectiveProject(snapshot, references);
  if (projectDiagnosticsForTargets(graph.diagnostics).some((issue) => issue.severity === 'error'))
    throw new Error(
      projectDiagnosticsForTargets(graph.diagnostics)
        .map((issue) => issue.message)
        .join('\n')
    );
  if (!graph.documents.length) throw new Error('No .rosetta sources match the configured source patterns.');
  return graph.documents as LangiumDocument<RosettaModel>[];
}

export { PROJECT_TOOLCHAIN, validateProjectTarget, type ProjectBuildResult } from './project-build.js';
import { projectTargetNamespaces, runProjectBuild } from './project-build.js';

/** Native parser host for the same staged build transaction used by Studio. */
export async function buildProject(
  snapshot: ProjectSnapshot,
  request: {
    targets: readonly string[] | 'all';
    signal?: AbortSignal;
    referenceTransport?: ReferenceTransport;
    referenceCache?: ReferenceCache;
    providers?: readonly ImplementationProvider[];
  },
  adapter: ProjectFileAdapter
) {
  const signal = request.signal ?? new AbortController().signal;
  const loaded = await loadProjectReferences(
    snapshot,
    request.referenceTransport ?? createReferenceTransport(),
    request.referenceCache ?? createMemoryReferenceCache(),
    signal
  );
  if (loaded.diagnostics.length) return { status: 'failed' as const, diagnostics: loaded.diagnostics, outputs: [] };
  const graph = await buildEffectiveProject(snapshot, loaded.documents, request.providers);
  const selected = request.targets === 'all' ? Object.keys(snapshot.project.build.targets) : request.targets;
  const graphDiagnostics = projectDiagnosticsForTargets(graph.diagnostics, selected);
  if (graphDiagnostics.some((issue) => issue.severity === 'error'))
    return { status: 'failed' as const, diagnostics: graphDiagnostics, outputs: [] };
  const documents = graph.documents as LangiumDocument<RosettaModel>[];
  return runProjectBuild(snapshot, { ...request, projectReceipt: graph.receipt }, adapter, async (captured, target) => {
    if (!documents.length) throw new Error('No .rosetta sources match the configured source patterns.');
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
    const selection = { namespaces, declarations: [] };
    assertProjectGenerationCapabilities(graph, selection, target.generator);
    const options: GeneratorOptions = {
      projectBindings: graph.implementationBindings,
      projectResources: graph.bindings,
      target: target.generator as Target,
      strict: true,
      [target.generator]: validated.value
    };
    return (await generateSelected(documents, selection, options)).outputs;
  });
}
