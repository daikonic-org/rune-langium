// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { URI, type LangiumDocument } from 'langium';
import {
  createRuneDslServices,
  hydrateModelDocuments,
  setProjectDocumentModel,
  setProjectRedirects,
  projectDeclarationIdentity,
  declarationKey,
  isRosettaFunction,
  isRosettaTypeAlias,
  getEffectiveProjectDeclaration,
  type RosettaFunction,
  type DeclarationIdentity,
  isRosettaModel,
  type RuneDslServices,
  type ProjectResolutionContext
} from '@rune-langium/core';
import {
  projectSourcePaths,
  projectDiagnosticsForTargets,
  type ProjectSnapshot,
  type ProjectDiagnostic
} from '@rune-langium/project-config';
import { projectOverrideRedirects, validateProjectOverrides, type ProjectDeclarations } from './override-validation.js';
import type { ReferenceDocument } from './references/types.js';
import { projectSourceUri, projectReferenceUri } from './project-uri.js';
import { createProjectReceipt, projectReceiptMatches, type EffectiveProjectReceipt } from './project-receipt.js';
import {
  createProjectBindingRegistry,
  projectCodeListForAlias,
  type ProjectBindingRegistry,
  type ProjectCodeListBinding
} from '@rune-langium/codegen/export';
import {
  createProjectBindings,
  resolveProjectCapabilities,
  type Capability,
  type ImplementationProvider,
  type ProjectBindingContext
} from './capabilities.js';
import { projectCapabilityImpact } from './capability-impact.js';
import { readProjectResolutionContext } from './project-context.js';
export type { EffectiveProjectReceipt } from './project-receipt.js';
export interface EffectiveProject {
  bindings: ProjectBindingRegistry;
  implementationBindings: ReadonlyMap<RosettaFunction, DeclarationIdentity>;
  capabilities: Capability[];
  services: RuneDslServices;
  documents: readonly LangiumDocument[];
  receipt: EffectiveProjectReceipt;
  diagnostics: ProjectDiagnostic[];
}
export interface EffectiveProjectInput {
  snapshot: ProjectSnapshot;
  referenceDocuments: readonly ReferenceDocument[];
  resolution: ProjectResolutionContext;
  receipt: EffectiveProjectReceipt;
}

/** Host adoption verifies the captured context and acknowledges only a successfully linked graph. */
export async function applyEffectiveProject(
  input: EffectiveProjectInput,
  providers: readonly ImplementationProvider[] = []
): Promise<EffectiveProject> {
  const context = await readProjectResolutionContext(input.resolution);
  const graph = await buildEffectiveProject(input.snapshot, input.referenceDocuments, providers);
  if (
    !projectReceiptMatches(context.context.receipt, input.receipt) ||
    !projectReceiptMatches(graph.receipt, input.receipt)
  )
    throw new Error('Project receipt does not match the captured source and configuration.');
  if (projectDiagnosticsForTargets(graph.diagnostics).some((issue) => issue.severity === 'error'))
    throw new Error(
      projectDiagnosticsForTargets(graph.diagnostics)
        .map((issue) => issue.message)
        .join('\n')
    );
  return graph;
}
/** A fresh services container owns every root and reference in this captured project generation. */
export async function buildEffectiveProject(
  snapshot: ProjectSnapshot,
  referenceDocuments: readonly ReferenceDocument[],
  providers: readonly ImplementationProvider[] = []
): Promise<EffectiveProject> {
  const all = createRuneDslServices();
  const { RuneDsl: services, shared } = all;
  const documents: LangiumDocument[] = [];
  const overrides = snapshot.project.build.overrides ?? [];
  const receipt = await createProjectReceipt(snapshot);
  const configured = projectOverrideRedirects(overrides);
  const result: EffectiveProject = {
    services,
    documents,
    receipt,
    diagnostics: [...configured.diagnostics],
    bindings: createProjectBindingRegistry({}),
    implementationBindings: new Map(),
    capabilities: []
  };
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
      register(factory.fromString(snapshot.files.get(path)!, URI.parse(projectSourceUri(path))), 'local');
    }
    const serialized: { uri: URI; json: string }[] = [];
    for (const entry of referenceDocuments) {
      const [model, ...path] = entry.uri.split('/');
      if (!model || !path.length) throw new Error('Reference document has no owning model: ' + entry.uri);
      const uri = URI.parse(projectReferenceUri(entry.uri));
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
    const symbols = new Set(declarations.map((entry) => declarationKey(entry.identity)));
    result.diagnostics.push(...validateProjectOverrides(services, overrides, declarations));
    if (result.diagnostics.length) return result;
    await shared.workspace.DocumentBuilder.build(documents, { validation: true, eagerLinking: true });
    result.diagnostics.push(...validateProjectOverrides(services, overrides, declarations, true));
    if (result.diagnostics.length) return result;
    const effectiveSymbols = new Map(
      declarations.flatMap((entry) => {
        const node = getEffectiveProjectDeclaration(entry.node);
        const symbol = node && projectDeclarationIdentity(services, node);
        return symbol ? [[declarationKey(entry.identity), symbol] as const] : [];
      })
    );
    const dispatchedFamilies = new Set(
      declarations
        .filter((entry) => entry.identity.dispatch !== undefined)
        .map((entry) => declarationKey({ ...entry.identity, dispatch: undefined }))
    );
    const implementationErrors = new Map(
      declarations
        .filter((entry) => dispatchedFamilies.has(declarationKey({ ...entry.identity, dispatch: undefined })))
        .map((entry) => [
          declarationKey(entry.identity),
          'Installed implementation bindings for dispatch families are not supported.'
        ])
    );
    const context: ProjectBindingContext = { symbols, effectiveSymbols, implementationErrors };
    const bindings = createProjectBindings(snapshot, providers, context);
    const resourceErrors = new Map<string, string>();
    const additionalCodeLists: ProjectCodeListBinding[] = [];
    for (const entry of declarations) {
      if (!isRosettaTypeAlias(entry.node)) continue;
      try {
        const values = projectCodeListForAlias(entry.node, bindings);
        if (values !== undefined) additionalCodeLists.push({ symbol: entry.identity, values });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        resourceErrors.set(declarationKey(entry.identity), reason);
        additionalCodeLists.push({ symbol: entry.identity, unavailable: reason });
      }
    }
    context.resourceErrors = resourceErrors;
    context.additionalCodeLists = additionalCodeLists;
    result.bindings = createProjectBindings(snapshot, providers, context);
    result.capabilities = resolveProjectCapabilities(snapshot, providers, context);
    for (const binding of additionalCodeLists.filter((entry) => entry.unavailable)) {
      if (
        result.capabilities.some((capability) =>
          capability.affectedDeclarations?.some((symbol) => declarationKey(symbol) === declarationKey(binding.symbol))
        )
      )
        continue;
      result.capabilities.push({
        id: 'resource:alias:' + declarationKey(binding.symbol),
        status: 'unavailable',
        reason: binding.unavailable,
        affectedTargets: [],
        affectedFunctions: [],
        affectedDeclarations: [binding.symbol]
      });
    }
    const nativeSymbols = new Map(
      result.bindings.implementationSymbols.map((symbol) => [declarationKey(symbol), symbol])
    );
    result.implementationBindings = new Map(
      declarations.flatMap((entry) => {
        const symbol = nativeSymbols.get(declarationKey(entry.identity));
        return symbol && isRosettaFunction(entry.node) ? [[entry.node, symbol] as const] : [];
      })
    );
    if (result.capabilities.length) {
      const impact = projectCapabilityImpact(snapshot, result, declarations);
      result.diagnostics.push(...impact.diagnostics);
      result.capabilities = impact.capabilities;
      result.bindings = createProjectBindings(snapshot, providers, {
        ...context,
        unavailableFunctions: impact.unavailableFunctions
      });
    }
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

export { assertProjectGenerationCapabilities } from './capability-impact.js';
