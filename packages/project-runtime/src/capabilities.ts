// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { declarationKey } from '@rune-langium/core';
import type { ProjectSnapshot, SymbolIdentity } from '@rune-langium/project-config';
import {
  createProjectBindingRegistry,
  type ProjectCodeListBinding,
  type ProjectImplementationBinding
} from '@rune-langium/codegen/export';
import { jsonCodec } from '@rune-langium/codegen/instances';
import { resolveProjectResource } from './resources.js';
import type { ImplementationProvider } from './implementations.js';
export type { ImplementationProvider } from './implementations.js';
export interface Capability {
  id: string;
  status: 'available' | 'unavailable';
  reason?: string;
  affectedTargets: string[];
  affectedFunctions: SymbolIdentity[];
}
function callableTargets(snapshot: ProjectSnapshot) {
  return Object.entries(snapshot.project.build.targets)
    .filter(([, target]) => target.generator === 'typescript')
    .map(([name]) => name);
}
function prepared(
  snapshot: ProjectSnapshot,
  providers: readonly ImplementationProvider[],
  knownSymbols?: ReadonlySet<string>
) {
  const capabilities: Capability[] = [];
  const implementations: ProjectImplementationBinding[] = [];
  const codeLists: ProjectCodeListBinding[] = [];
  for (const mapping of snapshot.project.build.overrides ?? []) {
    if (mapping.kind === 'implementation') {
      const matches = providers.filter((provider) => provider.id === mapping.provider);
      let reason: string | undefined =
        mapping.source.kind !== 'RosettaFunction'
          ? 'Only Rune function implementation bindings are supported.'
          : knownSymbols && !knownSymbols.has(declarationKey(mapping.source))
            ? 'The implementation source does not identify one function in the effective project.'
            : undefined;
      try {
        if (matches.length !== 1 || !matches[0]!.supports(mapping.source))
          reason ??= 'One installed, registered provider must support this exact symbol.';
      } catch {
        reason = 'The installed provider could not establish support for this symbol.';
      }
      capabilities.push({
        id: 'implementation:' + mapping.provider,
        status: reason ? 'unavailable' : 'available',
        ...(reason ? { reason } : {}),
        affectedTargets: callableTargets(snapshot),
        affectedFunctions: [mapping.source]
      });
      implementations.push({
        symbol: mapping.source,
        ...(reason ? { unavailable: reason } : { invoke: (args) => matches[0]!.invoke(args) })
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
      capabilities.push({
        id: 'resource:' + mapping.source.model + ':' + mapping.source.id,
        status: reason ? 'unavailable' : 'available',
        ...(reason ? { reason } : {}),
        affectedTargets: [],
        affectedFunctions: []
      });
      if (
        match &&
        knownSymbols &&
        !knownSymbols.has(
          declarationKey({ model: mapping.source.model, namespace: match[1]!, name: match[2]!, kind: match[3]! })
        )
      ) {
        reason = 'The code-list source does not identify one alias in the effective project.';
        const capability = capabilities[capabilities.length - 1]!;
        capability.status = 'unavailable';
        capability.reason = reason;
      }
      if (match)
        codeLists.push({
          symbol: { model: mapping.source.model, namespace: match[1]!, name: match[2]!, kind: match[3]! },
          ...(reason ? { unavailable: reason } : { values })
        });
    }
  }
  const model = snapshot.project.rune.model as { defaultSerialisationFormat?: unknown } | undefined;
  const codec = model?.defaultSerialisationFormat;
  if (codec !== undefined && codec !== 'JSON' && codec !== 'json')
    capabilities.push({
      id: 'codec:' + String(codec),
      status: 'unavailable',
      reason: 'No installed codec supports this configured serialization format.',
      affectedTargets: [],
      affectedFunctions: []
    });
  return { capabilities, implementations, codeLists };
}
/** Availability reports do not turn an absent native implementation into a valid empty result. */
export function resolveProjectCapabilities(
  snapshot: ProjectSnapshot,
  providers: readonly ImplementationProvider[],
  knownSymbols?: ReadonlySet<string>
): Capability[] {
  return prepared(snapshot, providers, knownSymbols).capabilities;
}
export function createProjectBindings(
  snapshot: ProjectSnapshot,
  providers: readonly ImplementationProvider[],
  knownSymbols?: ReadonlySet<string>
) {
  const result = prepared(snapshot, providers, knownSymbols);
  return createProjectBindingRegistry(result);
}

/** Defaults never silently substitute plain JSON for an unsupported configured codec. */
function requireJsonCodec(snapshot: ProjectSnapshot): void {
  const codec = resolveProjectCapabilities(snapshot, []).find(
    (capability) => capability.id.startsWith('codec:') && capability.status === 'unavailable'
  );
  if (codec) throw new Error(codec.reason + ' (' + codec.id + ')');
}
export function serializeProjectData(snapshot: ProjectSnapshot, value: unknown): string {
  requireJsonCodec(snapshot);
  const text = JSON.stringify(value, null, 2);
  if (text === undefined) throw new Error('The JSON codec cannot serialize this value.');
  return text;
}
export function importProjectData(snapshot: ProjectSnapshot, input: string | Uint8Array, target: string) {
  requireJsonCodec(snapshot);
  return jsonCodec.import(input, target);
}
