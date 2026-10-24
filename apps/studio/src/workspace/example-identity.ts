// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { namespaceFromModelName } from '@rune-langium/core';
import { declarationKey } from '@rune-langium/core/project-contract';
import { previewTypeSymbol } from '@rune-langium/codegen/export';
import type { SymbolIdentity } from '@rune-langium/project-config';
import type { InstanceRecord } from '@rune-langium/codegen/instances';
import type { WorkspaceState } from '../shell/providers/workspace-context.js';
import { withInstrumentation } from '../services/instrumentation/core.js';
type IdentitySource = Pick<WorkspaceState, 'files' | 'parsedModels' | 'deferredExports'>;
const identityCache = new WeakMap<IdentitySource, readonly SymbolIdentity[]>();
/** Shared source-ownership index; a refreshed immutable workspace gets a new index. */
export const workspaceDeclarationIdentities = withInstrumentation(
  function workspaceDeclarationIdentities(state: IdentitySource): readonly SymbolIdentity[] {
    const cached = identityCache.get(state);
    if (cached) return cached;
    const identities = new Map<string, SymbolIdentity>();
    const files = new Map(state.files.map((file) => [file.path, file]));
    const add = (path: string, namespace: string, symbol: { type: string; name: string }) => {
      const file = files.get(path);
      if (!file || !namespace) return;
      const model =
        file.bundleId ??
        (path.startsWith('system://') ? 'stdlib' : !file.refOnly && !file.readOnly ? 'local' : undefined);
      if (!model) return;
      const identity = { model, namespace, kind: symbol.type, name: symbol.name };
      identities.set(declarationKey(identity), identity);
    };
    for (const entry of state.parsedModels)
      for (const node of entry.model.elements)
        if ('name' in node && typeof node.name === 'string')
          add(entry.filePath, namespaceFromModelName(entry.model.name ?? '') ?? '', {
            type: node.$type,
            name: node.name
          });
    for (const entry of state.deferredExports)
      for (const symbol of entry.exports) add(entry.filePath, entry.namespace, symbol);
    for (const file of state.files)
      if (file.namespace) for (const symbol of file.exports ?? []) add(file.path, file.namespace, symbol);
    const result = Object.freeze([...identities.values()]);
    identityCache.set(state, result);
    return result;
  },
  { op: 'workspaceDeclarationIdentities', capture: 0 }
);
/** Only a unique declaration with known source ownership can bind a legacy FQN. */
export const resolveExampleType = withInstrumentation(
  function resolveExampleType(
    state: IdentitySource,
    record: Pick<InstanceRecord, 'typeFqn' | 'typeIdentity'>,
    kind?: string
  ): SymbolIdentity | undefined {
    const fqn = record.typeFqn.split('#')[0];
    const matches = workspaceDeclarationIdentities(state).filter(
      (identity) =>
        (identity.namespace + '.' + identity.name === fqn || (identity.model === 'stdlib' && identity.name === fqn)) &&
        (!kind || identity.kind === kind) &&
        (!record.typeIdentity || declarationKey(record.typeIdentity) === declarationKey(identity))
    );
    return matches.length === 1 ? matches[0] : undefined;
  },
  { op: 'resolveExampleType', capture: 0 }
);
/** Preview labels omit the owner; bind them only when the actual source identity is unique. */
export const resolvePresentationType = withInstrumentation(
  function resolvePresentationType(state: IdentitySource, symbol: string): SymbolIdentity | undefined {
    const matches = workspaceDeclarationIdentities(state).filter((identity) => {
      const builtin =
        identity.model === 'stdlib' &&
        ['RosettaBasicType', 'RosettaRecordType', 'RosettaTypeAlias'].includes(identity.kind);
      return (
        previewTypeSymbol(identity.kind, identity.namespace + '.' + identity.name) === symbol ||
        (builtin && previewTypeSymbol('builtin', identity.name) === symbol)
      );
    });
    return matches.length === 1 ? matches[0] : undefined;
  },
  { op: 'resolvePresentationType', capture: 0 }
);
