// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import type { ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { NamespaceExplorerPanel, selectNodeRepository, useEditorStore } from '@rune-langium/visual-editor';
import { declarationKey } from '@rune-langium/codegen/export';
import type { ExportSelection } from '@rune-langium/codegen/export';
import type { ExplorerSelectionAction } from '@rune-langium/visual-editor';
import {
  exportSelectionFromExplorer,
  exportSelectionIdForNode,
  exportSelectionToExplorerSet,
  exportDeclarationFromNode
} from '../../services/export-explorer-selection.js';
import { withInstrumentation } from '../../services/instrumentation/core.js';
import { viewTypeInExplore } from '../../services/explore-navigation.js';

export interface ExportSelectionPanelProps {
  selection: ExportSelection;
  requiredBy?: ReadonlyMap<string, readonly string[]>;
  included?: ExportSelection['declarations'];
  includedCount?: number;
  onChange(selection: ExportSelection): void;
  onNavigate?(namespace: string, name: string): void;
}

/** Reuses the shared type explorer to collect semantic export roots. */
export const ExportSelectionPanel = withInstrumentation(
  function ExportSelectionPanel({
    selection,
    requiredBy,
    included,
    includedCount,
    onChange,
    onNavigate
  }: ExportSelectionPanelProps): ReactElement {
    const nodesById = useEditorStore((state) => state.nodesById);
    const repository = selectNodeRepository(nodesById);
    const namespaces = useMemo(() => repository.namespaces(), [repository]);
    const [expandedNamespaces, setExpandedNamespaces] = useState<Set<string>>(() => new Set(namespaces));

    useEffect(() => {
      setExpandedNamespaces(new Set(namespaces));
    }, [namespaces]);

    const explicit = useMemo(() => exportSelectionToExplorerSet(selection, repository), [repository, selection]);
    const explicitCount = selection.namespaces.length + selection.declarations.length;
    const unavailableDependencies = useMemo(() => {
      if (!included || !requiredBy) return [];
      const visible = new Set(repository.all().map(exportSelectionIdForNode));
      return included.filter(
        (declaration) => requiredBy.has(declarationKey(declaration)) && !visible.has(declarationKey(declaration))
      );
    }, [included, repository, requiredBy]);
    const handleChange = useCallback(
      (next: Set<string>, action?: ExplorerSelectionAction) => {
        onChange(exportSelectionFromExplorer(next, selection, repository, action));
      },
      [onChange, repository, selection]
    );

    return (
      <section data-testid="export-selection" className="flex h-full min-h-0 flex-col overflow-auto studio-scroll">
        <div className="shrink-0 border-b px-3 py-2">
          <h2 className="text-sm font-semibold">Export selection</h2>
          <p className="text-xs text-muted-foreground">
            Select declarations or namespaces. Referenced declarations are included automatically when generated.
          </p>
          <p className="mt-1 text-xs text-muted-foreground" data-testid="export-selection-summary">
            {explicitCount === 0
              ? 'No export roots selected'
              : includedCount === undefined
                ? `${explicitCount} ${explicitCount === 1 ? 'root' : 'roots'} selected · Dependencies resolve on generation`
                : `${explicitCount} ${explicitCount === 1 ? 'root' : 'roots'} selected · ${includedCount} declarations included`}
          </p>
        </div>
        <div className="min-h-0 flex-1">
          <NamespaceExplorerPanel
            nodeRepository={repository}
            expandedNamespaces={expandedNamespaces}
            hiddenNodeIds={new Set()}
            onToggleNamespace={() => undefined}
            onExpandAll={() => setExpandedNamespaces(new Set(namespaces))}
            onCollapseAll={() => setExpandedNamespaces(new Set())}
            onSelectNode={(id) => {
              if (!onNavigate) return viewTypeInExplore(id);
              const node = repository.all().find((entry) => entry.id === id);
              const declaration = node && exportDeclarationFromNode(node);
              if (declaration) onNavigate(declaration.namespace, declaration.name);
            }}
            selection={{
              explicit,
              requiredBy: requiredBy ?? new Map(),
              getSelectionId: exportSelectionIdForNode,
              onChange: handleChange
            }}
          />
        </div>
        {unavailableDependencies.length > 0 && (
          <div
            className="border-t px-3 py-2 text-xs text-muted-foreground"
            data-testid="unavailable-export-dependencies"
          >
            <p className="font-medium text-foreground">Included dependencies unavailable in this explorer</p>
            <ul className="mt-1 list-inside list-disc">
              {unavailableDependencies.map((declaration) => (
                <li key={declarationKey(declaration)}>
                  {declaration.namespace}.{declaration.name} ({declaration.kind})
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    );
  },
  { op: 'ExportSelectionPanel' }
);
