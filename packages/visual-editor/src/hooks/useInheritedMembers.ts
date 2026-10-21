// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * useInheritedMembers — Resolves the inheritance chain for a graph node.
 *
 * Walks up the superType/parent chain through the editor store's nodes,
 * collecting members from each ancestor. Returns an array of groups,
 * one per ancestor, ordered from immediate parent to root.
 *
 * @module
 */

import { buildImportAliasMap, importAliasCandidates } from '@rune-langium/core';
import type { NamespaceImport } from '@rune-langium/core';
import { useMemo } from 'react';
import type { AnyGraphNode, TypeGraphNode } from '../types.js';
import { getRefText, resolveNodeKind, getTypeRefText, formatCardinality } from '../adapters/model-helpers.js';
import { makeNodeId } from '../store/node-projection.js';
import type { NodeRepository } from '../store/node-repository.js';

// Narrow shapes for type-safe access to union members
interface RefShape {
  $refText?: string;
}
interface DataShape {
  superType?: RefShape;
  attributes?: unknown[];
}
interface EnumShape {
  parent?: RefShape;
  enumValues?: unknown[];
}
interface FuncShape {
  superFunction?: RefShape;
  inputs?: unknown[];
}
interface RecordShape {
  features?: unknown[];
}

export interface InheritedGroup {
  /** Name of the ancestor type. */
  ancestorName: string;
  imports?: readonly NamespaceImport[];
  /** Namespace of the ancestor. */
  namespace: string;
  /** Kind of the ancestor node. */
  kind: string;
  /** Members inherited from this ancestor (raw AST-shaped objects). */
  members: unknown[];
}

/**
 * Get the parent/super type name from a node's data based on its $type.
 */
function getParentName(d: AnyGraphNode): string | undefined {
  switch (d.$type) {
    case 'Data':
      return getRefText((d as unknown as DataShape).superType);
    case 'RosettaEnumeration':
      return getRefText((d as unknown as EnumShape).parent);
    case 'RosettaFunction':
      return getRefText((d as unknown as FuncShape).superFunction);
    default:
      return undefined;
  }
}

/**
 * Get the member array from a node based on its $type.
 */
function getMembers(d: AnyGraphNode): unknown[] {
  const rec = d as unknown as DataShape & EnumShape & FuncShape & RecordShape;
  return rec.attributes ?? rec.enumValues ?? rec.inputs ?? rec.features ?? [];
}

/**
 * Walk up the parent chain and collect inherited member groups.
 *
 * @param nodeData - The current node's data.
 * @param allNodes - All graph nodes (to resolve parent references).
 * @param maxDepth - Safety limit to prevent cycles (default: 20).
 * @returns Array of inherited groups, one per ancestor (parent first).
 */
export function useInheritedMembers(
  nodeData: AnyGraphNode | null,
  allNodes: TypeGraphNode[],
  maxDepth = 20,
  nodeRepository?: NodeRepository
): InheritedGroup[] {
  const parentName = nodeData ? getParentName(nodeData) : undefined;
  return useMemo(() => {
    if (!parentName || allNodes.length === 0) return [];

    const groups: InheritedGroup[] = [];
    const visited = new Set<string>();
    let currentParentName: string | undefined = parentName;
    let depth = 0;
    let imports = allNodes.find((node) => node.data === nodeData)?.meta.imports;

    while (currentParentName && depth < maxDepth) {
      let parentNode: TypeGraphNode | undefined;
      for (const candidate of importAliasCandidates(currentParentName, buildImportAliasMap(imports ?? []))) {
        parentNode =
          nodeRepository?.byId(candidate) ??
          allNodes.find(
            (node) => node.data.name === candidate || makeNodeId(node.meta.namespace, node.data.name) === candidate
          );
        if (parentNode) break;
      }
      if (!parentNode || visited.has(parentNode.id)) break;
      visited.add(parentNode.id);
      imports = parentNode.meta.imports;

      const pd = parentNode.data;
      const members = getMembers(pd);
      if (members.length > 0) {
        groups.push({
          ancestorName: pd.name,
          ...(imports ? { imports } : {}),
          namespace: parentNode.meta.namespace,
          kind: resolveNodeKind(parentNode),
          members
        });
      }

      currentParentName = getParentName(pd);
      depth++;
    }

    return groups;
  }, [parentName, allNodes, maxDepth, nodeRepository]);
}

// Canonical local and inherited member shapes.

interface LocalMemberField {
  id: string;
  name?: string;
}

interface ReferenceTextShape {
  $refText?: string;
}

interface TypeCallShape {
  type?: ReferenceTextShape;
}

interface CardinalityShape {
  inf: number;
  sup?: number;
  unbounded: boolean;
}

interface InheritedAttributeMemberShape {
  name?: string;
  typeCall?: TypeCallShape;
  card?: CardinalityShape;
}

interface InheritedEnumValueMemberShape {
  name?: string;
  display?: string;
  displayName?: string;
}

// ---------------------------------------------------------------------------
// Effective Members — unified view of local + inherited
// ---------------------------------------------------------------------------

export interface EffectiveEntry {
  imports?: readonly NamespaceImport[];
  namespace?: string;
  id: string;
  name: string;
  source: 'local' | 'inherited';
  typeName?: string;
  cardinality?: string;
  displayName?: string;
  fieldIndex?: number;
  ancestorName?: string;
  inheritanceDepth?: number;
  isOverride: boolean;
  rawMember?: unknown;
}

export interface EffectiveMembersResult {
  effective: EffectiveEntry[];
  overrideNames: Set<string>;
  inheritedNames: Set<string>;
}

/**
 * Compute effective members by merging local + inherited.
 *
 * Local members come from the node's own member array.
 * Inherited members come from walking the parent chain.
 * A local member with the same name as an inherited one is an "override" —
 * the inherited version is excluded from the effective list.
 *
 * Removing a local override causes the inherited member to reappear on re-render.
 */
export function useEffectiveMembers(
  nodeData: AnyGraphNode | null,
  allNodes: TypeGraphNode[],
  localFields?: LocalMemberField[]
): EffectiveMembersResult {
  const inheritedGroups = useInheritedMembers(nodeData, allNodes);

  return useMemo(() => {
    if (!nodeData) return { effective: [], overrideNames: new Set<string>(), inheritedNames: new Set<string>() };

    const localMembers = getMembers(nodeData);
    const localNames = new Set<string>();

    const localEntries: EffectiveEntry[] = localMembers.map((member, i) => {
      const m = member as InheritedAttributeMemberShape & InheritedEnumValueMemberShape;
      const name = m.name ?? '';
      localNames.add(name);
      return {
        id: localFields?.[i]?.id ?? `local:${name}:${i}`,
        name,
        source: 'local' as const,
        typeName: getTypeRefText(m.typeCall),
        cardinality: formatCardinality(m.card),
        displayName: m.display ?? m.displayName,
        fieldIndex: i,
        isOverride: false
      };
    });

    const inheritedNames = new Set<string>();
    const inheritedEntries: EffectiveEntry[] = [];
    const seenNames = new Set(localNames);

    for (let depth = 0; depth < inheritedGroups.length; depth++) {
      const group = inheritedGroups[depth]!;
      for (const member of group.members) {
        const m = member as InheritedAttributeMemberShape & InheritedEnumValueMemberShape;
        const name = m.name ?? '';
        inheritedNames.add(name);
        if (!seenNames.has(name)) {
          seenNames.add(name);
          inheritedEntries.push({
            id: `inherited:${group.ancestorName}:${name}`,
            name,
            source: 'inherited' as const,
            typeName: getTypeRefText(m.typeCall),
            cardinality: formatCardinality(m.card),
            displayName: m.display ?? m.displayName,
            ancestorName: group.ancestorName,
            namespace: group.namespace,
            ...(group.imports ? { imports: group.imports } : {}),
            inheritanceDepth: depth + 1,
            isOverride: false,
            rawMember: member
          });
        }
      }
    }

    const overrideNames = new Set<string>();
    for (const entry of localEntries) {
      if (inheritedNames.has(entry.name)) {
        entry.isOverride = true;
        overrideNames.add(entry.name);
      }
    }

    return { effective: [...localEntries, ...inheritedEntries], overrideNames, inheritedNames };
  }, [nodeData, localFields, inheritedGroups]);
}
