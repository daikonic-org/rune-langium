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
import { useTypeNavigationMenu } from '../TypeNavigationMenu.js';
import { TypeChip, type TypeChipKind } from './structure/TypeChip.js';
import {
  buildImportAliasMap,
  importAliasCandidates,
  buildImportScope,
  importScopeCandidates
} from '@rune-langium/core';
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
  /** Use the canonical type chip while retaining navigation behavior. */
  typeKind?: TypeChipKind;
}

/**
 * Resolve a short type name to a kind-aware graph node ID.
 * Exact Rune-qualified-name match first; then exact last-segment match via nameFromNodeId to avoid
 * namespace-segment collisions (e.g. "a.Foo.Bar" must NOT match typeName="Foo").
 * Providing a namespace restricts lookup to that file scope and disables the global bare-name fallback.
 */
export function resolveNodeId(
  typeName: string,
  allNodeIds: readonly string[] | ReadonlySet<string>,
  imports: readonly NamespaceImport[] = [],
  namespace?: string
): string | undefined {
  const candidates =
    namespace === undefined
      ? importAliasCandidates(typeName, buildImportAliasMap(imports))
      : importScopeCandidates(typeName, buildImportScope(namespace, imports));
  for (const candidate of candidates) {
    // A scoped copy must never resolve against an unrelated bare-name export.
    if (namespace !== undefined && !typeName.includes('.') && candidate === typeName) continue;
    for (const id of allNodeIds) if (isTypeNodeId(id) && qualifiedNameFromNodeId(id) === candidate) return id;
  }
  if (namespace !== undefined || typeName.includes('.')) return undefined;
  for (const id of allNodeIds) if (isTypeNodeId(id) && nameFromNodeId(id) === typeName) return id;
  return undefined;
}

export function TypeLink({ typeName, onNavigateToNode, allNodeIds, className, typeKind }: TypeLinkProps) {
  const imports = useContext(TypeReferenceImports);
  const resolvedNodeId = typeName && allNodeIds ? resolveNodeId(typeName, allNodeIds, imports) : undefined;
  const navigation = useTypeNavigationMenu({ onNavigate: onNavigateToNode });
  if (!typeName) return null;

  // If no navigation callback, render as plain text
  if (!onNavigateToNode) {
    if (typeKind)
      return <TypeChip as="span" typeName={typeName} typeKind={typeKind} data-slot="type-link" className={className} />;
    return (
      <span data-slot="type-link" className={className}>
        {typeName}
      </span>
    );
  }

  // Resolve once per render — avoids duplicate linear scans
  const isResolvable = !!resolvedNodeId;

  const handleClick = () => {
    if (resolvedNodeId) {
      onNavigateToNode(resolvedNodeId);
    }
  };

  const linkProps = {
    'data-slot': 'type-link',
    onClick: handleClick,
    onContextMenu: (event: React.MouseEvent<HTMLElement>) => navigation.open(event, resolvedNodeId),
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => navigation.onKeyDown(event, resolvedNodeId),
    title: isResolvable ? `Go to ${typeName}` : typeName,
    disabled: !isResolvable
  };
  return (
    <>
      {typeKind ? (
        <TypeChip {...linkProps} typeName={typeName} typeKind={typeKind} className={className} />
      ) : (
        <button
          {...linkProps}
          type="button"
          className={`${className ?? ''} ${isResolvable ? 'text-primary hover:underline cursor-pointer' : ''}`.trim()}
        >
          {typeName}
        </button>
      )}
      {navigation.menu}
    </>
  );
}
