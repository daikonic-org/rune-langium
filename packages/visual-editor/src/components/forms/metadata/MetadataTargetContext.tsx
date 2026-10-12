// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { createContext, useContext, useCallback, type ReactNode } from 'react';
import { useLatestRef } from '../../../hooks/useLatestRef.js';
import {
  getMetadataCapabilities,
  type MetadataNode,
  type MetadataCapabilities,
  type MetadataCommand,
  type MetadataEditResult,
  type InspectorMetadataActions
} from '../../../store/metadata-target.js';
import type { InspectorRowBinding, InspectorSelection } from './useInspectorSelection.js';

export interface PendingMetadata {
  scopeKey: string;
  rowKey: string;
  command: MetadataCommand;
}
export interface MetadataTargetBinding {
  node: MetadataNode;
  formPrefix?: string;
  readOnly: boolean;
  capabilities: MetadataCapabilities;
  envelope(command: MetadataCommand): PendingMetadata;
  commitPending(pending: PendingMetadata): MetadataEditResult;
  commit(command: MetadataCommand): MetadataEditResult;
}
const Context = createContext<MetadataTargetBinding | null>(null);
export function MetadataTargetProvider({ value, children }: { value: MetadataTargetBinding; children: ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useMetadataTarget(): MetadataTargetBinding | null {
  return useContext(Context);
}

export function getInspectorMetadataActions(
  actions: Partial<InspectorMetadataActions>
): InspectorMetadataActions | undefined {
  const { captureMetadataTarget, applyMetadataCommand } = actions;
  return captureMetadataTarget && applyMetadataCommand ? { captureMetadataTarget, applyMetadataCommand } : undefined;
}

export function useMetadataBinding(props: {
  scopeKey: string;
  nodeId: string;
  root: MetadataNode;
  row?: InspectorRowBinding;
  selection: InspectorSelection;
  actions?: InspectorMetadataActions;
  readOnly?: boolean;
}): MetadataTargetBinding {
  const current = useLatestRef(props);
  const commitPending = useCallback(
    (pending: PendingMetadata): MetadataEditResult => {
      const live = current.current;
      if (pending.scopeKey !== live.scopeKey) return { status: 'stale' };
      const row = pending.rowKey === '$root' ? undefined : live.selection.resolve(pending.rowKey, pending.scopeKey);
      if (pending.rowKey !== '$root' && !row) return { status: 'stale' };
      if (row && !row.inherited && !row.path) return { status: 'unsupported' };
      if (live.readOnly || row?.inherited) return { status: 'readOnly' };
      if (!live.actions) return { status: 'unsupported' };
      const target = live.actions.captureMetadataTarget(live.nodeId, row?.path ?? []);
      return target ? live.actions.applyMetadataCommand(target, pending.command) : { status: 'stale' };
    },
    [current]
  );
  const envelope = (command: MetadataCommand): PendingMetadata => ({
    scopeKey: props.scopeKey,
    rowKey: props.row?.key ?? '$root',
    command
  });
  const node = props.row?.node ?? props.row?.readonlyNode ?? props.root;
  return {
    node,
    readOnly: Boolean(props.readOnly || props.row?.inherited),
    formPrefix: props.row?.inherited ? undefined : (props.row?.path ?? []).join('.'),
    capabilities: getMetadataCapabilities(node),
    envelope,
    commitPending,
    commit: (command) => commitPending(envelope(command))
  };
}
