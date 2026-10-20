// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * GraphContextMenu — Right-click context menu for graph nodes.
 *
 * Provides actions like "Show only this & neighbors", "Hide node",
 * and "Show all nodes" to control graph visibility.
 *
 * Uses the shared Base UI menu anchored at cursor coordinates.
 */

import { useCallback } from 'react';
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator
} from '@rune-langium/design-system/ui/dropdown-menu';
import { useEditorStore } from '../store/editor-store.js';
import type { LayoutEngine, TypeGraphNode, NavigateToNodeCallback } from '../types.js';
import { PointerMenu } from './PointerMenu.js';
import { TypeNavigationMenuItems } from './TypeNavigationMenu.js';

export interface ContextMenuState {
  /** Screen position for the menu. */
  x: number;
  y: number;
  /** The node that was right-clicked (null for pane context menu). */
  node: TypeGraphNode | null;
}

export interface GraphContextMenuProps {
  state: ContextMenuState | null;
  layoutEngine: LayoutEngine;
  onLayoutEngineChange?: (engine: LayoutEngine) => void;
  onClose: () => void;
  onNavigate?: NavigateToNodeCallback;
  onInspect?: NavigateToNodeCallback;
}

export function GraphContextMenu({
  state,
  layoutEngine,
  onLayoutEngineChange,
  onClose,
  onNavigate,
  onInspect
}: GraphContextMenuProps) {
  const isolateNode = useEditorStore((s) => s.isolateNode);
  const revealNeighbors = useEditorStore((s) => s.revealNeighbors);
  const showAllNodes = useEditorStore((s) => s.showAllNodes);
  const toggleNodeVisibility = useEditorStore((s) => s.toggleNodeVisibility);
  const selectNode = useEditorStore((s) => s.selectNode);

  const handleIsolate = useCallback(() => {
    if (state?.node) {
      isolateNode(state.node.id);
      selectNode(state.node.id);
    }
    onClose();
  }, [state, isolateNode, selectNode, onClose]);

  const handleRevealNeighbors = useCallback(() => {
    if (state?.node) {
      revealNeighbors(state.node.id);
    }
    onClose();
  }, [state, revealNeighbors, onClose]);

  const handleHideNode = useCallback(() => {
    if (state?.node) {
      toggleNodeVisibility(state.node.id);
    }
    onClose();
  }, [state, toggleNodeVisibility, onClose]);

  const handleShowAll = useCallback(() => {
    showAllNodes();
    onClose();
  }, [showAllNodes, onClose]);

  const handleUseEngine = useCallback(
    (engine: LayoutEngine) => {
      onLayoutEngineChange?.(engine);
      onClose();
    },
    [onClose, onLayoutEngineChange]
  );

  const nodeName = state?.node?.data?.name ?? 'Unknown';

  return (
    <PointerMenu position={state} onClose={onClose} testId="graph-context-menu">
      {state?.node && (onNavigate || onInspect) && (
        <>
          <TypeNavigationMenuItems
            nodeId={state.node.id}
            onNavigate={onNavigate}
            onInspect={onInspect}
            onClose={onClose}
          />
          <DropdownMenuSeparator />
        </>
      )}
      {state?.node && (
        <>
          <DropdownMenuGroup>
            <DropdownMenuLabel className="truncate">{nodeName}</DropdownMenuLabel>
            <DropdownMenuItem onClick={handleRevealNeighbors}>
              <span aria-hidden className="w-4 text-center">
                ◉
              </span>
              Show related nodes
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleIsolate}>
              <span aria-hidden className="w-4 text-center">
                ⊙
              </span>
              Focus on this &amp; neighbors
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleHideNode}>
              <span aria-hidden className="w-4 text-center">
                ⊘
              </span>
              Hide this node
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
        </>
      )}
      <DropdownMenuItem onClick={handleShowAll}>
        <span aria-hidden className="w-4 text-center">
          ◎
        </span>
        Show all nodes
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      {/* Layout engine is a mutually-exclusive choice → RadioGroup, not
            menuitem+aria-pressed (invalid ARIA for role=menuitem). The radio
            item renders its own selected indicator. (Copilot #227) */}
      <DropdownMenuRadioGroup value={layoutEngine} onValueChange={(v: string) => handleUseEngine(v as 'elk' | 'dagre')}>
        <DropdownMenuRadioItem value="elk">Use ELK layout</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="dagre">Use Dagre layout</DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </PointerMenu>
  );
}
