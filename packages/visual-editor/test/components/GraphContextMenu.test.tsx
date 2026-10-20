// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { parse } from '@rune-langium/core';
import { GraphContextMenu } from '../../src/components/GraphContextMenu.js';
import { useEditorStore } from '../../src/store/editor-store.js';

describe('GraphContextMenu with real menu primitives', () => {
  it('navigates and inspects the canonical node through the owning callbacks', async () => {
    const model = await parse('namespace context\ntype Example:\n value string (0..1)\n');
    useEditorStore.getState().loadModels(model.value);
    const node = useEditorStore.getState().nodes[0]!;
    const onNavigate = vi.fn();
    const onInspect = vi.fn();
    const onClose = vi.fn();
    render(
      <GraphContextMenu
        state={{ x: 100, y: 100, node }}
        layoutEngine="dagre"
        onClose={onClose}
        onNavigate={onNavigate}
        onInspect={onInspect}
      />
    );
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Go to type', exact: true }));
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(node.id);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Inspect type', exact: true }));
    expect(onInspect).toHaveBeenCalledExactlyOnceWith(node.id);
    expect(onClose).toHaveBeenCalled();
  });

  it('labels node actions and sends hide to the editor store', async () => {
    const model = await parse('namespace context\ntype Example:\n value string (0..1)\n');
    useEditorStore.getState().loadModels(model.value);
    const node = useEditorStore.getState().nodes[0]!;
    const onClose = vi.fn();
    render(<GraphContextMenu state={{ x: 100, y: 100, node }} layoutEngine="dagre" onClose={onClose} />);
    expect(await screen.findByRole('group', { name: 'Example' })).toBeVisible();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hide this node' }));
    expect(useEditorStore.getState().visibility.hiddenNodeIds.has(node.id)).toBe(true);
    expect(onClose).toHaveBeenCalled();
  });

  it('offers canvas actions without a node group and changes the layout engine', async () => {
    const onClose = vi.fn();
    const onLayoutEngineChange = vi.fn();
    render(
      <GraphContextMenu
        state={{ x: 100, y: 100, node: null }}
        layoutEngine="dagre"
        onClose={onClose}
        onLayoutEngineChange={onLayoutEngineChange}
      />
    );
    expect(await screen.findByRole('menuitem', { name: 'Show all nodes' })).toBeVisible();
    expect(screen.queryByRole('menuitem', { name: 'Hide this node' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Use ELK layout' }));
    expect(onLayoutEngineChange).toHaveBeenCalledWith('elk');
    expect(onClose).toHaveBeenCalled();
  });
});
