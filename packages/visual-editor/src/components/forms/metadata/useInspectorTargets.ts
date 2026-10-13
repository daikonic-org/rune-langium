// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { isAttribute, isChoiceOption, isRosettaEnumValue } from '@rune-langium/core';
import { useRef } from 'react';
import { useInspectorSelection, type InspectorRowBinding } from './useInspectorSelection.js';
import { getInspectorMetadataActions, useMetadataBinding } from './MetadataTargetContext.js';
import { getTypeRefText, formatCardinality } from '../../../adapters/model-helpers.js';
import { readAtMetadataPath, getMetadataMemberName, type MetadataNode } from '../../../store/metadata-target.js';
import type {
  AnyGraphNode,
  CommonFormActions,
  DataFormActions,
  FuncFormActions,
  EnumFormActions
} from '../../../types.js';
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
  fields: readonly {
    id: string;
    name?: string;
    typeCall?: Parameters<typeof getTypeRefText>[0];
    $cstRange?: { offset: number; end: number };
  }[];
  collection: 'attributes' | 'inputs' | 'enumValues';
  effective?: readonly EffectiveEntry[];
  actions: CommonFormActions &
    Partial<
      Pick<DataFormActions, 'updateAttribute'> &
        Pick<FuncFormActions, 'updateInputParam'> &
        Pick<EnumFormActions, 'updateEnumValue'>
    >;
  scopeKey?: string;
  parseEpoch?: number;
  readOnly?: boolean;
  output?: boolean;
}) {
  const fieldEpochs = useRef(new Map<string, number | undefined>());
  const members =
    (root as { attributes?: MetadataNode[]; inputs?: MetadataNode[]; enumValues?: MetadataNode[] })[collection] ?? [];
  const byRange = new Map<string, Array<{ node: MetadataNode; index: number }>>();
  const byName = new Map<string, Array<{ node: MetadataNode; index: number }>>();
  members.forEach((node, index) => {
    const entry = { node, index };
    const range = node.$cstRange;
    if (range) {
      const key = `${range.offset}:${range.end}`;
      byRange.set(key, [...(byRange.get(key) ?? []), entry]);
    }
    const name = getMetadataMemberName(node);
    if (name !== undefined) byName.set(name, [...(byName.get(name) ?? []), entry]);
  });
  const activeKeys = new Set(fields.map((field) => field.id));
  for (const key of fieldEpochs.current.keys()) if (!activeKeys.has(key)) fieldEpochs.current.delete(key);
  const rows: InspectorRowBinding[] = fields.flatMap((field) => {
    if (!fieldEpochs.current.has(field.id)) fieldEpochs.current.set(field.id, parseEpoch);
    const range = field.$cstRange;
    const sameEpoch = fieldEpochs.current.get(field.id) === parseEpoch;
    const identityName = getMetadataMemberName(field);
    const candidates =
      (sameEpoch && range
        ? byRange.get(`${range.offset}:${range.end}`)
        : identityName !== undefined
          ? byName.get(identityName)
          : undefined) ?? [];
    if (candidates.length !== 1) return [];
    const { node, index } = candidates[0]!;
    const name = getMetadataMemberName(node) ?? '';
    return [{ key: field.id, name, path: [collection, index] as const, inherited: false, node, parseEpoch }];
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
  const renameRow = (key: string, name: string) => {
    const row = selection.resolve(key, scopeKey);
    if (readOnly || row?.inherited || !row?.node || !row.path) return;
    const captured = guarded?.captureMetadataTarget(nodeId, row.path);
    const member = captured?.expected ?? row.node;
    if (captured && row.parseEpoch !== undefined && captured.parseEpoch !== row.parseEpoch) return;
    const range = row.node.$cstRange;
    if (
      captured &&
      member !== row.node &&
      (range ? member.$cstRange?.offset !== range.offset || member.$cstRange?.end !== range.end : true)
    )
      return;
    if (isAttribute(member)) {
      const type = getTypeRefText(member.typeCall) ?? 'string';
      const card =
        formatCardinality(member.card ? { ...member.card, unbounded: member.card.unbounded ?? false } : undefined) ||
        '(1..1)';
      if (root.$type === 'RosettaFunction') actions.updateInputParam?.(nodeId, member.name, name, type, card);
      else actions.updateAttribute?.(nodeId, member.name, name, type, card);
    } else if (isRosettaEnumValue(member)) actions.updateEnumValue?.(nodeId, member.name, name, member.display);
  };
  return { rows, selection, rootBinding, childBinding, renameRow };
}
