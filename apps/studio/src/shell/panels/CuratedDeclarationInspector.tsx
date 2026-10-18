// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { useEffect, useState, type ReactNode, type ComponentProps } from 'react';
import { EditorFormPanel, type EditorFormActions, type TypeGraphNode } from '@rune-langium/visual-editor';
import type { CuratedCacheSeed } from '../../services/curated-cache-seeds.js';
import { loadCuratedDeclaration } from '../../services/curated-declaration.js';
import { withInstrumentation } from '../../services/instrumentation/core.js';

/** An explicitly incomplete, read-only view; the caller owns full semantic readiness. */
export const CuratedDeclarationInspector = withInstrumentation(
  function CuratedDeclarationInspector({
    seed,
    nodeId,
    scope,
    isHydrating,
    actions,
    availableTypes = [],
    allNodes,
    nodeRepository,
    children
  }: {
    seed?: CuratedCacheSeed;
    nodeId: string | null;
    scope: string;
    isHydrating: boolean;
    actions: EditorFormActions;
    children: ReactNode;
  } & Partial<Pick<ComponentProps<typeof EditorFormPanel>, 'availableTypes' | 'allNodes' | 'nodeRepository'>>) {
    const key = JSON.stringify([scope, nodeId, seed?.key]);
    const [result, setResult] = useState<{ key: string; node: TypeGraphNode }>();
    const artifactKey = seed?.key;
    const bundleId = seed?.bundleId;
    const version = seed?.version;
    const namespace = seed?.namespace;
    useEffect(() => {
      if (!nodeId || !artifactKey || !bundleId || !version || !namespace) return;
      const controller = new AbortController();
      void loadCuratedDeclaration({ key: artifactKey, bundleId, version, namespace }, nodeId, controller.signal)
        .then((node) => {
          if (node && !controller.signal.aborted) setResult({ key, node });
        })
        .catch(() => {
          // The authoritative hydration still owns retry/error presentation.
        });
      return () => controller.abort();
    }, [key, nodeId, artifactKey, bundleId, version, namespace]);

    if (!seed || result?.key !== key) return children;
    return (
      <div className="flex flex-col min-h-0 h-full" data-inspector-readiness="declaration">
        <p role="status" className="shrink-0 px-3 py-2 text-xs text-muted-foreground border-b">
          {isHydrating
            ? 'Declared fields available. Loading dependencies for inheritance, expressions and previews…'
            : 'Declaration available. Full dependency information is not available yet.'}
        </p>
        <div className="flex-1 min-h-0">
          <EditorFormPanel
            nodeData={result.node.data}
            meta={result.node.meta}
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
