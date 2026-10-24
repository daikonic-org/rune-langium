// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { declarationKey } from '@rune-langium/core';
import type { ProjectSnapshot, SymbolIdentity } from '@rune-langium/project-config';
import {
  createProjectBindingRegistry,
  type ProjectCodeListBinding,
  type ProjectImplementationBinding
} from '@rune-langium/codegen/export';
import { projectDataCodecStatus } from './project-data.js';
export { serializeProjectData, importProjectData } from './project-data.js';
import { resolveProjectResource } from './resources.js';
import type { ImplementationProvider } from './implementations.js';
export type { ImplementationProvider } from './implementations.js';
export interface Capability {
  id: string;
  status: 'available' | 'unavailable';
  reason?: string;
  affectedTargets: string[];
  affectedFunctions: SymbolIdentity[];
  affectedDeclarations?: SymbolIdentity[];
}
function callableTargets(snapshot: ProjectSnapshot) {
  return Object.entries(snapshot.project.build.targets)
    .filter(([, target]) => target.generator === 'typescript')
    .map(([name]) => name);
}
export interface ProjectBindingContext {
  symbols?: ReadonlySet<string>;
  additionalCodeLists?: readonly ProjectCodeListBinding[];
  effectiveSymbols?: ReadonlyMap<string, SymbolIdentity>;
  resourceErrors?: ReadonlyMap<string, string>;
  implementationErrors?: ReadonlyMap<string, string>;
  unavailableFunctions?: readonly { symbol: SymbolIdentity; reason: string }[];
}
function prepared(
  snapshot: ProjectSnapshot,
  providers: readonly ImplementationProvider[],
  context: ProjectBindingContext = {}
) {
  const knownSymbols = context.symbols;
  const capabilities: Capability[] = [];
  const implementations: ProjectImplementationBinding[] = [];
  const codeLists: ProjectCodeListBinding[] = [];
  for (const mapping of snapshot.project.build.overrides ?? []) {
    if (mapping.kind === 'implementation') {
      const matches = providers.filter((provider) => provider.id === mapping.provider);
      let reason: string | undefined =
        mapping.source.dispatch !== undefined
          ? 'Installed implementation bindings for dispatch families are not supported.'
          : mapping.source.kind !== 'RosettaFunction'
            ? 'Only Rune function implementation bindings are supported.'
            : knownSymbols && !knownSymbols.has(declarationKey(mapping.source))
              ? 'The implementation source does not identify one function in the effective project.'
              : context.implementationErrors?.get(declarationKey(mapping.source));
      try {
        if (matches.length !== 1 || !matches[0]!.supports({ ...mapping.source }))
          reason ??= 'One installed, registered provider must support this exact symbol.';
      } catch {
        reason = 'The installed provider could not establish support for this symbol.';
      }
      capabilities.push({
        id: 'implementation:' + mapping.provider + ':' + declarationKey(mapping.source),
        status: reason ? 'unavailable' : 'available',
        ...(reason ? { reason } : {}),
        affectedTargets: callableTargets(snapshot),
        affectedFunctions: [mapping.source],
        affectedDeclarations: [mapping.source]
      });
      implementations.push({
        symbol: mapping.source,
        ...(reason ? { unavailable: reason } : { invoke: matches[0]!.invoke.bind(matches[0]) })
      });
    } else if (mapping.kind === 'resource') {
      const resource = resolveProjectResource(snapshot, mapping.source);
      const match = /^(.+)\.([^.]+)#(RosettaTypeAlias)$/.exec(mapping.source.id);
      let reason = 'message' in resource ? resource.message : undefined;
      let values: ProjectCodeListBinding['values'];
      if (!match)
        reason ??=
          'No installed adapter declares this resource ID. The JSON code-list adapter requires a kind-qualified string alias identity.';
      if (!reason && !('message' in resource))
        try {
          const parsed: unknown = JSON.parse(snapshot.files.get(resource.path)!);
          if (
            !Array.isArray(parsed) ||
            parsed.some(
              (entry) =>
                !entry ||
                typeof entry !== 'object' ||
                typeof entry.value !== 'string' ||
                typeof entry.label !== 'string'
            ) ||
            new Set(parsed.map((entry) => entry.value)).size !== parsed.length
          )
            throw new Error('Expected distinct code-list entries with string value and label.');
          values = parsed.map((entry) => ({ value: entry.value, label: entry.label }));
        } catch (error) {
          reason = error instanceof Error ? error.message : 'Resource decoding is unavailable.';
        }
      const original = match
        ? { model: mapping.source.model, namespace: match[1]!, name: match[2]!, kind: match[3]! }
        : undefined;
      const symbol = original && (context.effectiveSymbols?.get(declarationKey(original)) ?? original);
      if (original && knownSymbols && !knownSymbols.has(declarationKey(original)))
        reason = 'The code-list source does not identify one alias in the effective project.';
      if (symbol) reason ??= context.resourceErrors?.get(declarationKey(symbol));
      capabilities.push({
        id: 'resource:' + mapping.source.model + ':' + mapping.source.id,
        status: reason ? 'unavailable' : 'available',
        ...(reason ? { reason } : {}),
        affectedTargets: [],
        affectedFunctions: [],
        ...(symbol ? { affectedDeclarations: [symbol] } : {})
      });
      if (symbol) codeLists.push({ symbol, ...(reason ? { unavailable: reason } : { values }) });
    }
  }
  const codec = projectDataCodecStatus(snapshot);
  if (codec.status === 'unavailable') capabilities.push({ ...codec, affectedTargets: [], affectedFunctions: [] });
  return { capabilities, implementations, codeLists };
}
/** Availability reports do not turn an absent native implementation into a valid empty result. */
export function resolveProjectCapabilities(
  snapshot: ProjectSnapshot,
  providers: readonly ImplementationProvider[],
  context: ProjectBindingContext = {}
): Capability[] {
  return prepared(snapshot, providers, context).capabilities;
}
export function createProjectBindings(
  snapshot: ProjectSnapshot,
  providers: readonly ImplementationProvider[],
  context: ProjectBindingContext = {}
) {
  const result = prepared(snapshot, providers, context);
  const codeLists = new Map(result.codeLists.map((binding) => [declarationKey(binding.symbol), binding]));
  for (const binding of context.additionalCodeLists ?? []) codeLists.set(declarationKey(binding.symbol), binding);
  return createProjectBindingRegistry({
    ...result,
    codeLists: [...codeLists.values()],
    unavailableFunctions: context.unavailableFunctions
  });
}
