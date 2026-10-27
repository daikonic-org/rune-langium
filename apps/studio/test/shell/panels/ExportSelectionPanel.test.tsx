// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useEditorStore, type ExplorerSelection, type ExplorerSelectionAction } from '@rune-langium/visual-editor';
import { ExportSelectionPanel } from '../../../src/shell/panels/ExportSelectionPanel.js';

let explorerSelection: ExplorerSelection | undefined;
let navigateToType: ((id: string) => void) | undefined;
const { viewTypeInExplore } = vi.hoisted(() => ({ viewTypeInExplore: vi.fn() }));

vi.mock('../../../src/services/explore-navigation.js', () => ({ viewTypeInExplore }));

vi.mock('@rune-langium/visual-editor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@rune-langium/visual-editor')>();
  return {
    ...actual,
    NamespaceExplorerPanel: (props: { selection?: ExplorerSelection; onSelectNode?(id: string): void }) => {
      explorerSelection = props.selection;
      navigateToType = props.onSelectNode;
      return <div data-testid="shared-type-explorer" />;
    }
  };
});

afterEach(() => {
  explorerSelection = undefined;
  navigateToType = undefined;
  viewTypeInExplore.mockClear();
  useEditorStore.setState({ nodesById: new Map() } as never);
});

function setNodes(): void {
  const node = {
    id: 'test.Party',
    meta: { namespace: 'test' },
    data: { $type: 'Data', name: 'Party' }
  };
  useEditorStore.setState({ nodesById: new Map([[node.id, node]]) } as never);
}

it('navigates through Explore without changing export inclusion', () => {
  setNodes();
  const onChange = vi.fn();
  render(<ExportSelectionPanel selection={{ namespaces: [], declarations: [] }} onChange={onChange} />);
  act(() => navigateToType?.('test.Party'));
  expect(viewTypeInExplore).toHaveBeenCalledWith('test.Party');
  expect(onChange).not.toHaveBeenCalled();
});

it('routes declaration navigation to generated output when Export supplies a handler', () => {
  setNodes();
  const onChange = vi.fn();
  const onNavigate = vi.fn();
  render(
    <ExportSelectionPanel
      selection={{ namespaces: [], declarations: [] }}
      onChange={onChange}
      onNavigate={onNavigate}
    />
  );
  act(() => navigateToType?.('test.Party'));
  expect(onNavigate).toHaveBeenCalledWith('test', 'Party');
  expect(viewTypeInExplore).not.toHaveBeenCalled();
  expect(onChange).not.toHaveBeenCalled();
});

it('converts shared explorer declaration selection into a codegen root', () => {
  setNodes();
  const onChange = vi.fn();
  const requiredBy = new Map([['["test","Data","Party"]', ['["test","Func","lookupParty"]']]]);
  const { rerender } = render(
    <ExportSelectionPanel
      selection={{ namespaces: [], declarations: [] }}
      requiredBy={requiredBy}
      onChange={onChange}
    />
  );

  expect(explorerSelection?.explicit).toEqual(new Set());
  expect(explorerSelection?.requiredBy).toBe(requiredBy);
  act(() => explorerSelection?.onChange(new Set(['["test","Data","Party"]'])));
  expect(onChange).toHaveBeenLastCalledWith({
    namespaces: [],
    declarations: [{ namespace: 'test', name: 'Party', kind: 'Data' }]
  });

  rerender(
    <ExportSelectionPanel
      selection={{ namespaces: [], declarations: [{ namespace: 'test', name: 'Party', kind: 'Data' }] }}
      onChange={onChange}
    />
  );
  act(() => explorerSelection?.onChange(new Set()));
  expect(onChange).toHaveBeenLastCalledWith({ namespaces: [], declarations: [] });
});

it('retains namespace roots from shared explorer namespace actions', () => {
  setNodes();
  const onChange = vi.fn();
  const action: ExplorerSelectionAction = { kind: 'namespace', namespaces: ['test'], checked: true };
  const { rerender } = render(
    <ExportSelectionPanel selection={{ namespaces: [], declarations: [] }} onChange={onChange} />
  );

  act(() => explorerSelection?.onChange(new Set(['["test","Data","Party"]']), action));
  expect(onChange).toHaveBeenLastCalledWith({ namespaces: ['test'], declarations: [] });

  rerender(<ExportSelectionPanel selection={{ namespaces: ['test'], declarations: [] }} onChange={onChange} />);
  act(() => explorerSelection?.onChange(new Set(), { ...action, checked: false }));
  expect(onChange).toHaveBeenLastCalledWith({ namespaces: [], declarations: [] });
});

it('removes individually selected declaration roots when a namespace is cleared', () => {
  setNodes();
  const onChange = vi.fn();
  const selection = { namespaces: [], declarations: [{ namespace: 'test', name: 'Party', kind: 'Data' }] };
  render(<ExportSelectionPanel selection={selection} onChange={onChange} />);

  act(() => explorerSelection?.onChange(new Set(), { kind: 'namespace', namespaces: ['test'], checked: false }));

  expect(onChange).toHaveBeenLastCalledWith({ namespaces: [], declarations: [] });
});

it('shows receipt-derived dependency count only after generation', () => {
  setNodes();
  const { rerender } = render(
    <ExportSelectionPanel
      selection={{ namespaces: [], declarations: [{ namespace: 'test', name: 'Party', kind: 'Data' }] }}
      onChange={vi.fn()}
    />
  );

  expect(screen.getByTestId('export-selection-summary')).toHaveTextContent(
    '1 root selected · Dependencies resolve on generation'
  );
  rerender(
    <ExportSelectionPanel
      selection={{ namespaces: [], declarations: [{ namespace: 'test', name: 'Party', kind: 'Data' }] }}
      includedCount={2}
      onChange={vi.fn()}
    />
  );
  expect(screen.getByTestId('export-selection-summary')).toHaveTextContent('1 root selected · 2 declarations included');
});

it('lists receipt dependencies absent from the current explorer catalog', () => {
  setNodes();
  render(
    <ExportSelectionPanel
      selection={{ namespaces: [], declarations: [{ namespace: 'test', name: 'Party', kind: 'Data' }] }}
      included={[
        { namespace: 'test', name: 'Party', kind: 'Data' },
        { namespace: 'external', name: 'Address', kind: 'Data' }
      ]}
      requiredBy={new Map([['["external","Data","Address"]', ['["test","Data","Party"]']]])}
      onChange={vi.fn()}
    />
  );

  expect(screen.getByTestId('unavailable-export-dependencies')).toHaveTextContent('external.Address (Data)');
});
