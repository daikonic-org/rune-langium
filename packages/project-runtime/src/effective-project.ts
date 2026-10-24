// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { URI, type LangiumDocument } from 'langium';
import {
  createRuneDslServices,
  hydrateModelDocuments,
  setProjectDocumentModel,
  setProjectRedirects,
  projectDeclarationIdentity,
  isRosettaModel,
  type RuneDslServices
} from '@rune-langium/core';
import {
  canonicalProjectJson,
  projectFileRevision,
  projectSourcePaths,
  type ProjectSnapshot,
  type ProjectDiagnostic
} from '@rune-langium/project-config';
import { projectOverrideRedirects, validateProjectOverrides, type ProjectDeclarations } from './override-validation.js';
import type { ReferenceDocument } from './references/types.js';
export interface EffectiveProjectReceipt {
  revision: string;
  lockDigest: string;
  overridesDigest: string;
}
export interface EffectiveProject {
  services: RuneDslServices;
  documents: readonly LangiumDocument[];
  receipt: EffectiveProjectReceipt;
  diagnostics: ProjectDiagnostic[];
}
/** A fresh services container owns every root and reference in this captured project generation. */
export async function buildEffectiveProject(
  snapshot: ProjectSnapshot,
  referenceDocuments: readonly ReferenceDocument[]
): Promise<EffectiveProject> {
  const all = createRuneDslServices();
  const { RuneDsl: services, shared } = all;
  const documents: LangiumDocument[] = [];
  const overrides = snapshot.project.build.overrides ?? [];
  const receipt = {
    revision: snapshot.revision,
    lockDigest: await projectFileRevision(canonicalProjectJson(snapshot.lock ?? null)),
    overridesDigest: await projectFileRevision(canonicalProjectJson(overrides))
  };
  const configured = projectOverrideRedirects(overrides);
  const result: EffectiveProject = { services, documents, receipt, diagnostics: [...configured.diagnostics] };
  if (result.diagnostics.length) return result;
  try {
    await shared.workspace.WorkspaceManager.initializeWorkspace([]);
    const factory = shared.workspace.LangiumDocumentFactory;
    const register = (document: LangiumDocument, model: string) => {
      shared.workspace.LangiumDocuments.addDocument(document);
      setProjectDocumentModel(services, document.uri, model);
      documents.push(document);
    };
    for (const path of projectSourcePaths(snapshot.files, snapshot.project.build.sources)) {
      register(
        factory.fromString(
          snapshot.files.get(path)!,
          URI.parse('file:///project/' + path.split('/').map(encodeURIComponent).join('/'))
        ),
        'local'
      );
    }
    const serialized: { uri: URI; json: string }[] = [];
    for (const entry of referenceDocuments) {
      const [model, ...path] = entry.uri.split('/');
      if (!model || !path.length) throw new Error('Reference document has no owning model: ' + entry.uri);
      const uri = URI.parse(`[${model}]/${path.join('/')}`);
      if (shared.workspace.LangiumDocuments.hasDocument(uri))
        throw new Error('Duplicate project document URI: ' + entry.uri);
      setProjectDocumentModel(services, uri, model);
      if (entry.serialized) serialized.push({ uri, json: entry.serialized });
      else register(factory.fromString(entry.content, uri), model);
    }
    if (overrides.some((mapping) => mapping.kind === 'declaration'))
      setProjectRedirects(services, configured.redirects);
    // The hydrator registers every serialized root before any pointer is revived.
    documents.push(...hydrateModelDocuments(all, serialized).map((entry) => entry.document));
    const declarations: ProjectDeclarations[] = documents.flatMap((document) => {
      const root = document.parseResult.value;
      return isRosettaModel(root)
        ? root.elements.flatMap((node) => {
            const identity = projectDeclarationIdentity(services, node);
            return identity ? [{ identity, node }] : [];
          })
        : [];
    });
    result.diagnostics.push(...validateProjectOverrides(services, overrides, declarations));
    if (result.diagnostics.length) return result;
    await shared.workspace.DocumentBuilder.build(documents, { validation: true, eagerLinking: true });
    result.diagnostics.push(...validateProjectOverrides(services, overrides, declarations, true));
    for (const document of documents) {
      for (const error of [...document.parseResult.lexerErrors, ...document.parseResult.parserErrors])
        result.diagnostics.push({
          code: 'PROJECT_PARSE',
          severity: 'error',
          path: document.uri.toString(),
          message: error.message
        });
      for (const diagnostic of document.diagnostics ?? [])
        if (diagnostic.severity === 1)
          result.diagnostics.push({
            code: 'PROJECT_LINK',
            severity: 'error',
            path: document.uri.toString(),
            message: typeof diagnostic.message === 'string' ? diagnostic.message : diagnostic.message.value
          });
    }
  } catch (error) {
    result.diagnostics.push({
      code: 'PROJECT_GRAPH',
      severity: 'error',
      path: 'build-config.yml',
      message: error instanceof Error ? error.message : String(error)
    });
  }
  return result;
}
