// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { useEffect, useState, type ReactNode, type ComponentProps } from 'react';
import { EditorFormPanel, useLatestRef, type EditorFormActions, type TypeGraphNode } from '@rune-langium/visual-editor';
import { kindFromNodeId } from '@rune-langium/visual-editor/identifiers';
import { loadCuratedDeclarations, type CuratedDeclarationSource } from '../../services/curated-declaration.js';
import { withInstrumentation } from '../../services/instrumentation/core.js';

/** An explicitly incomplete, read-only view; the caller owns full semantic readiness. */
export const CuratedDeclarationInspector = withInstrumentation(
  function CuratedDeclarationInspector({
    source,
    nodeId,
    scope,
    isHydrating,
    actions,
    availableTypes = [],
    allNodes,
    nodeRepository,
    headerActions,
    children
  }: {
    source?: CuratedDeclarationSource;
    nodeId: string | null;
    scope: string;
    isHydrating: boolean;
    actions: EditorFormActions;
    children: ReactNode;
  } & Partial<
    Pick<ComponentProps<typeof EditorFormPanel>, 'availableTypes' | 'allNodes' | 'nodeRepository' | 'headerActions'>
  >) {
    const key =
      source &&
      ('documents' in source
        ? source
        : JSON.stringify([source.key, source.bundleId, source.version, source.namespace]));
    const sourceRef = useLatestRef(source);
    const [result, setResult] = useState<{ key: typeof key; scope: string; nodes: TypeGraphNode[] }>();
    // Function bodies and projections require Studio's complete editor slots.
    const kind = nodeId ? kindFromNodeId(nodeId) : undefined;
    const hasSelection = kind === 'Data' || kind === 'Choice' || kind === 'RosettaEnumeration';
    useEffect(() => {
      const currentSource = sourceRef.current;
      if (!hasSelection || !currentSource) return;
      const controller = new AbortController();
      void loadCuratedDeclarations(currentSource, controller.signal)
        .then((nodes) => {
          if (nodes.length && !controller.signal.aborted) setResult({ key, scope, nodes });
        })
        .catch(() => {
          // The authoritative hydration still owns retry/error presentation.
        });
      return () => controller.abort();
    }, [key, scope, hasSelection, sourceRef]);

    const node =
      result?.key === key && result?.scope === scope
        ? result.nodes.find((candidate) => candidate.id === nodeId)
        : undefined;
    if (!hasSelection || !source || !node) return children;
    return (
      <div className="flex flex-col min-h-0 h-full" data-inspector-readiness="declaration">
        <p role="status" className="shrink-0 px-3 py-2 text-xs text-muted-foreground border-b">
          {isHydrating
            ? 'Declared fields available. Loading dependencies for inheritance, expressions and previews…'
            : 'Declaration available. Full dependency information is not available yet.'}
        </p>
        <div className="flex-1 min-h-0">
          <EditorFormPanel
            nodeData={node.data}
            headerActions={headerActions}
            meta={node.meta}
            nodeId={nodeId}
            scopeKey={`${scope}:declaration`}
            actions={actions}
            availableTypes={availableTypes}
            allNodes={allNodes}
            nodeRepository={nodeRepository}
            refOnly
            compactConditions
          />
        </div>
      </div>
    );
  },
  { op: 'CuratedDeclarationInspector', capture: 0 }
);
