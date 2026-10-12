// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { isAttribute, isChoiceOption, isRosettaEnumValue } from '@rune-langium/core';
import { useInspectorSelection, type InspectorRowBinding } from './useInspectorSelection.js';
import { getInspectorMetadataActions, useMetadataBinding } from './MetadataTargetContext.js';
import { getTypeRefText } from '../../../adapters/model-helpers.js';
import { readAtMetadataPath, type MetadataNode } from '../../../store/metadata-target.js';
import type { AnyGraphNode, CommonFormActions } from '../../../types.js';
import type { EffectiveEntry } from '../../../hooks/useInheritedMembers.js';

export interface InspectorHostProps {
  scopeKey?: string;
  parseEpoch?: number;
  saveStatus?: string;
  registerCommitFlush?: (flush: () => void) => () => void;
}

/** Shared canonical row mapping before any paging or visual filtering. */
export function useInspectorTargets({
  nodeId,
  root,
  fields,
  collection,
  effective = [],
  actions,
  scopeKey = nodeId,
  parseEpoch,
  readOnly,
  output = false
}: {
  nodeId: string;
  root: AnyGraphNode;
  fields: readonly { id: string; name?: string }[];
  collection: 'attributes' | 'inputs' | 'enumValues';
  effective?: readonly EffectiveEntry[];
  actions: CommonFormActions;
  scopeKey?: string;
  parseEpoch?: number;
  readOnly?: boolean;
  output?: boolean;
}) {
  const rows: InspectorRowBinding[] = fields.map((field, index) => {
    const node = readAtMetadataPath(root, [collection, index]);
    const name = field.name ?? (node && 'typeCall' in node ? getTypeRefText(node.typeCall) : undefined) ?? '';
    return { key: field.id, name, path: [collection, index], inherited: false, node, parseEpoch };
  });
  for (const entry of effective) {
    const member = entry.rawMember;
    if (entry.source === 'inherited' && (isAttribute(member) || isChoiceOption(member) || isRosettaEnumValue(member)))
      rows.push({ key: entry.id, name: entry.name, inherited: true, readonlyNode: member as MetadataNode, parseEpoch });
  }
  const outputNode = output ? readAtMetadataPath(root, ['output']) : undefined;
  if (outputNode)
    rows.push({ key: '$output', name: 'Output', path: ['output'], inherited: false, node: outputNode, parseEpoch });
  const selection = useInspectorSelection(scopeKey, rows);
  const guarded = getInspectorMetadataActions(actions);
  const rootBinding = useMetadataBinding({ scopeKey, nodeId, root, selection, actions: guarded, readOnly });
  const childBinding = useMetadataBinding({
    scopeKey,
    nodeId,
    root,
    selection,
    row: selection.selectedRow,
    actions: guarded,
    readOnly: readOnly || !guarded
  });
  return { rows, selection, rootBinding: guarded ? rootBinding : null, childBinding };
}
