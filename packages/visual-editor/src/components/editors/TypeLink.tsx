// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * TypeLink — Clickable type reference that navigates to a type definition.
 *
 * Renders a type name as a button-styled link. When clicked, resolves the
 * type to a graph node ID and calls onNavigateToNode.
 *
 * @module
 */

import { createContext, useContext } from 'react';
import { buildImportAliasMap, importAliasCandidates } from '@rune-langium/core';
import type { NamespaceImport } from '@rune-langium/core';
import type { NavigateToNodeCallback } from '../../types.js';
import { isTypeNodeId, nameFromNodeId, qualifiedNameFromNodeId } from '../../store/node-projection.js';

export const TypeReferenceImports = createContext<readonly NamespaceImport[] | undefined>(undefined);

export interface TypeLinkProps {
  /** The type name to display (e.g., "Quantity", "CompareOp"). */
  typeName: string | undefined;
  /** Callback to navigate to the type's graph node. */
  onNavigateToNode?: NavigateToNodeCallback;
  /** All loaded graph nodes for resolving type name → node ID. */
  allNodeIds?: string[];
  /** Additional CSS classes. */
  className?: string;
}

/**
 * Resolve a short type name to a kind-aware graph node ID.
 * Exact Rune-qualified-name match first; then exact last-segment match via nameFromNodeId to avoid
 * namespace-segment collisions (e.g. "a.Foo.Bar" must NOT match typeName="Foo").
 */
export function resolveNodeId(
  typeName: string,
  allNodeIds: readonly string[] | ReadonlySet<string>,
  imports: readonly NamespaceImport[] = []
): string | undefined {
  for (const candidate of importAliasCandidates(typeName, buildImportAliasMap(imports))) {
    for (const id of allNodeIds) if (isTypeNodeId(id) && qualifiedNameFromNodeId(id) === candidate) return id;
  }
  if (typeName.includes('.')) return undefined;
  for (const id of allNodeIds) if (isTypeNodeId(id) && nameFromNodeId(id) === typeName) return id;
  return undefined;
}

export function TypeLink({ typeName, onNavigateToNode, allNodeIds, className }: TypeLinkProps) {
  const imports = useContext(TypeReferenceImports);
  if (!typeName) return null;

  // If no navigation callback, render as plain text
  if (!onNavigateToNode) {
    return (
      <span data-slot="type-link" className={className}>
        {typeName}
      </span>
    );
  }

  // Resolve once per render — avoids duplicate linear scans
  const resolvedNodeId = allNodeIds ? resolveNodeId(typeName, allNodeIds, imports) : undefined;
  const isResolvable = !!resolvedNodeId;

  const handleClick = () => {
    if (resolvedNodeId) {
      onNavigateToNode(resolvedNodeId);
    }
  };

  return (
    <button
      type="button"
      data-slot="type-link"
      onClick={handleClick}
      className={`${className ?? ''} ${isResolvable ? 'text-primary hover:underline cursor-pointer' : ''}`.trim()}
      title={isResolvable ? `Go to ${typeName}` : typeName}
      disabled={!isResolvable}
    >
      {typeName}
    </button>
  );
}
