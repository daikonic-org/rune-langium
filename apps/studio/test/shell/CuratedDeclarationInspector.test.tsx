// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { astToModel, type EditorFormActions, type TypeGraphNode } from '@rune-langium/visual-editor';
import { CuratedDeclarationInspector } from '../../src/shell/panels/CuratedDeclarationInspector.js';
import { loadCuratedDeclarations } from '../../src/services/curated-declaration.js';

vi.mock('../../src/services/curated-declaration.js', () => ({ loadCuratedDeclarations: vi.fn() }));
const seed = { key: 'key-a', namespace: 'example.selected', bundleId: 'cdm' as const, version: 'a' };
const node = astToModel({
  $type: 'RosettaModel',
  name: seed.namespace,
  elements: [
    {
      $type: 'Data',
      name: 'Selected',
      attributes: [
        {
          $type: 'Attribute',
          name: 'own',
          typeCall: { $type: 'TypeCall', type: { $refText: 'int' } },
          card: { $type: 'RosettaCardinality', inf: 0, sup: 1, unbounded: false },
          override: false
        }
      ],
      conditions: [],
      annotations: [],
      synonyms: []
    }
  ]
}).nodes[0]!;
const actions = {} as EditorFormActions;
function view(scope = 'workspace-a', selected = seed, id = node.id) {
  return (
    <CuratedDeclarationInspector seed={selected} nodeId={id} scope={scope} actions={actions} isHydrating>
      <p>Full workspace loading</p>
    </CuratedDeclarationInspector>
  );
}
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it('shows actual own fields read-only while full semantic content remains unavailable', async () => {
  vi.mocked(loadCuratedDeclarations).mockResolvedValue([node]);
  render(view());
  expect(await screen.findByText(/Declared fields available/)).toHaveTextContent('Loading dependencies');
  expect(screen.getByRole('heading', { name: 'Selected' })).toBeVisible();
  expect(screen.getByDisplayValue('own')).toBeDisabled();
  expect(screen.queryByText('Full workspace loading')).toBeNull();
});

it('reuses pending and completed namespace work while rendering the current selection', async () => {
  const other: TypeGraphNode = {
    ...node,
    id: 'example.selected.Other#Data',
    data: { ...node.data, name: 'Other' }
  };
  const pending = Promise.withResolvers<TypeGraphNode[]>();
  vi.mocked(loadCuratedDeclarations).mockReturnValue(pending.promise);
  const { rerender } = render(view());
  const signal = vi.mocked(loadCuratedDeclarations).mock.calls[0]![1];
  for (let i = 0; i < 20; i++) {
    rerender(view('workspace-a', seed, i % 2 ? other.id : node.id));
  }
  expect(loadCuratedDeclarations).toHaveBeenCalledTimes(1);
  expect(signal.aborted).toBe(false);
  await act(async () => pending.resolve([node, other]));
  expect(screen.getByRole('heading', { name: 'Other' })).toBeVisible();
  rerender(view());
  expect(screen.getByRole('heading', { name: 'Selected' })).toBeVisible();
  expect(screen.getByDisplayValue('own')).toBeDisabled();
  rerender(view('workspace-a', seed, 'example.selected.Missing#Data'));
  expect(screen.getByText('Full workspace loading')).toBeVisible();
  expect(loadCuratedDeclarations).toHaveBeenCalledTimes(1);
});

it.each(['workspace', 'cohort', 'namespace'])('discards an earlier result after a %s change', async (change) => {
  let finish!: (nodes: TypeGraphNode[]) => void;
  vi.mocked(loadCuratedDeclarations).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  vi.mocked(loadCuratedDeclarations).mockReturnValueOnce(new Promise(() => {}));
  const { rerender } = render(view());
  const signal = vi.mocked(loadCuratedDeclarations).mock.calls[0]![1];
  rerender(
    view(
      change === 'workspace' ? 'workspace-b' : 'workspace-a',
      change === 'cohort'
        ? { ...seed, key: 'key-b', version: 'b' }
        : change === 'namespace'
          ? { ...seed, namespace: 'other.namespace' }
          : seed
    )
  );
  expect(signal.aborted).toBe(true);
  await act(async () => finish([node]));
  expect(screen.getByText('Full workspace loading')).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Selected' })).toBeNull();
});

it('falls back to normal hydration on failure and yields when authoritative content arrives', async () => {
  vi.mocked(loadCuratedDeclarations).mockRejectedValueOnce(new Error('unavailable'));
  const { rerender } = render(view());
  await act(async () => {});
  expect(screen.getByText('Full workspace loading')).toBeVisible();
  rerender(
    <CuratedDeclarationInspector nodeId={node.id} scope="workspace-a" actions={actions} isHydrating={false}>
      <p>Fully linked fields and inheritance</p>
    </CuratedDeclarationInspector>
  );
  expect(screen.getByText('Fully linked fields and inheritance')).toBeVisible();
});

it('does not let a late declaration result replace the authoritative Inspector', async () => {
  let finish!: (nodes: TypeGraphNode[]) => void;
  vi.mocked(loadCuratedDeclarations).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const { rerender } = render(view());
  const signal = vi.mocked(loadCuratedDeclarations).mock.calls[0]![1];
  rerender(
    <CuratedDeclarationInspector nodeId={node.id} scope="workspace-a" actions={actions} isHydrating={false}>
      <p>Authoritative Inspector</p>
    </CuratedDeclarationInspector>
  );
  await act(async () => finish([node]));
  expect(signal.aborted).toBe(true);
  expect(screen.getByText('Authoritative Inspector')).toBeVisible();
  expect(screen.queryByText(/Declared fields available/)).toBeNull();
});

it('keeps the ordinary loading path when an older server has no immutable seed metadata', () => {
  render(
    <CuratedDeclarationInspector nodeId={node.id} scope="workspace-a" actions={actions} isHydrating>
      <p>Ordinary hydration</p>
    </CuratedDeclarationInspector>
  );
  expect(screen.getByText('Ordinary hydration')).toBeVisible();
  expect(loadCuratedDeclarations).not.toHaveBeenCalled();
});
