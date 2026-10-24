// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { withInstrumentation } from '../services/instrumentation/core.js';
import { namespaceFromModelName } from '@rune-langium/core';
import { declarationKey } from '@rune-langium/core/project-contract';
import type { SymbolIdentity } from '@rune-langium/project-config';
import type { InstanceRecord } from '@rune-langium/codegen/instances';
import type { WorkspaceState } from '../shell/providers/workspace-context.js';

/** Only a unique declaration with known source ownership can bind a legacy FQN. */
export const resolveExampleType = withInstrumentation(
  function resolveExampleType(
    state: Pick<WorkspaceState, 'files' | 'parsedModels' | 'deferredExports'>,
    record: Pick<InstanceRecord, 'typeFqn' | 'typeIdentity'>,
    kind?: string
  ): SymbolIdentity | undefined {
    const identities = new Map<string, SymbolIdentity>();
    const add = (path: string, namespace: string, symbol: { type: string; name: string }) => {
      const file = state.files.find((entry) => entry.path === path);
      if (!file || !namespace) return;
      const model =
        file.bundleId ??
        (path.startsWith('system://') ? 'stdlib' : !file.refOnly && !file.readOnly ? 'local' : undefined);
      if (!model || namespace + '.' + symbol.name !== record.typeFqn.split('#')[0] || (kind && symbol.type !== kind))
        return;
      const identity = { model, namespace, kind: symbol.type, name: symbol.name };
      if (record.typeIdentity && declarationKey(record.typeIdentity) !== declarationKey(identity)) return;
      identities.set(declarationKey(identity), identity);
    };
    for (const entry of state.parsedModels) {
      for (const node of entry.model.elements)
        if ('name' in node && typeof node.name === 'string') {
          add(entry.filePath, namespaceFromModelName(entry.model.name ?? '') ?? '', {
            type: node.$type,
            name: node.name
          });
        }
    }
    for (const entry of state.deferredExports)
      for (const symbol of entry.exports) add(entry.filePath, entry.namespace, symbol);
    for (const file of state.files)
      if (file.namespace) for (const symbol of file.exports ?? []) add(file.path, file.namespace, symbol);
    return identities.size === 1 ? [...identities.values()][0] : undefined;
  },
  { op: 'resolveExampleType', capture: 0, sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' }) }
);
