// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { isRosettaModel, projectDeclarationIdentity, declarationKey } from '@rune-langium/core';
import { generatePreviewSchemas } from '@rune-langium/codegen/export';
import {
  canonicalProjectJson,
  projectDiagnosticsForTargets,
  readExamples,
  readWorkflows,
  readPresentations,
  type ProjectSnapshot,
  type ProjectDiagnostic,
  type SymbolIdentity
} from '@rune-langium/project-config';
import { buildEffectiveProject, type EffectiveProject } from './effective-project.js';
import type { ReferenceDocument } from './references/types.js';

/** Inspect a proposed graph without adopting it; portable readers retain broken records. */
export async function reviewProjectCompatibility(
  snapshot: ProjectSnapshot,
  references: readonly ReferenceDocument[],
  previous?: { snapshot: ProjectSnapshot; referenceDocuments: readonly ReferenceDocument[] }
): Promise<ProjectDiagnostic[]> {
  const graph = await buildEffectiveProject(snapshot, references);
  const known = new Set(
    graph.documents.flatMap((document) => {
      const root = document.parseResult.value;
      return isRosettaModel(root)
        ? root.elements.flatMap((node) => {
            const identity = projectDeclarationIdentity(graph.services, node);
            return identity ? [declarationKey(identity)] : [];
          })
        : [];
    })
  );
  const examples = readExamples(snapshot, known);
  const workflows = readWorkflows(snapshot, known);
  const presentations = readPresentations(snapshot, known);
  const diagnostics: ProjectDiagnostic[] = [
    ...graph.diagnostics.map((issue) => (issue.target ? { ...issue, severity: 'warning' as const } : issue)),
    ...[...examples.diagnostics, ...workflows.diagnostics, ...presentations.diagnostics].map((issue) => ({
      ...issue,
      severity: 'warning' as const
    }))
  ];
  if (!previous || projectDiagnosticsForTargets(graph.diagnostics).some((issue) => issue.severity === 'error'))
    return diagnostics;
  const before = await buildEffectiveProject(previous.snapshot, previous.referenceDocuments);
  if (projectDiagnosticsForTargets(before.diagnostics).some((issue) => issue.severity === 'error')) {
    diagnostics.push({
      code: 'REFERENCE_BASELINE_UNAVAILABLE',
      severity: 'warning',
      path: 'build-config.lock.json',
      message:
        'The current graph is invalid, so schema changes cannot be compared. Review the proposed graph diagnostics before saving.'
    });
    return diagnostics;
  }
  const uses = [
    ...examples.documents.map((entry) => ({ path: entry.descriptorPath, type: entry.descriptor.type })),
    ...workflows.documents.flatMap(({ path, value }) =>
      [value.function, ...Object.values(value.outputs).map((output) => output.type)].flatMap((type) =>
        type ? [{ path, type }] : []
      )
    ),
    ...presentations.documents.map(({ path, value }) => ({ path, type: value.type }))
  ];
  const cache = new Map<EffectiveProject, Map<string, string | undefined>>();
  const shape = (project: EffectiveProject, type: SymbolIdentity) => {
    let schemas = cache.get(project);
    if (!schemas) {
      schemas = new Map();
      cache.set(project, schemas);
    }
    const key = declarationKey(type);
    if (schemas.has(key)) return schemas.get(key);
    const kind = { Data: 'data', Choice: 'choice', RosettaFunction: 'function', RosettaTypeAlias: 'typeAlias' }[
      type.kind
    ];
    if (!kind) throw new Error('No standalone preview contract is available for ' + type.kind);
    const schema = generatePreviewSchemas([...project.documents], {
      targetId: type.namespace + '.' + type.name,
      projectBindings: project.bindings
    }).find((entry) => (entry.kind ?? 'data') === kind);
    const value = schema
      ? canonicalProjectJson(
          JSON.parse(JSON.stringify(schema, (key, value) => (key === 'sourceMap' ? undefined : value)))
        )
      : undefined;
    schemas.set(key, value);
    return value;
  };
  const seen = new Set<string>();
  for (const use of uses) {
    const key = use.path + ':' + declarationKey(use.type);
    if (seen.has(key) || !known.has(declarationKey(use.type))) continue;
    seen.add(key);
    try {
      if (shape(before, use.type) !== shape(graph, use.type))
        diagnostics.push({
          code: 'REFERENCE_SCHEMA_CHANGED',
          severity: 'warning',
          path: use.path,
          message: `The schema or callable inputs/return for ${use.type.namespace}.${use.type.name} (${use.type.kind}, ${use.type.model}) changed. Review this saved binding before use.`
        });
    } catch (error) {
      diagnostics.push({
        code: 'REFERENCE_SCHEMA_UNAVAILABLE',
        severity: 'warning',
        path: use.path,
        message: `Could not compare ${use.type.namespace}.${use.type.name}: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }
  return diagnostics;
}
