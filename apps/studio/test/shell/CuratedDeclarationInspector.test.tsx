// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { astToModel, type EditorFormActions, type TypeGraphNode } from '@rune-langium/visual-editor';
import { CuratedDeclarationInspector } from '../../src/shell/panels/CuratedDeclarationInspector.js';
import { loadCuratedDeclaration } from '../../src/services/curated-declaration.js';

vi.mock('../../src/services/curated-declaration.js', () => ({ loadCuratedDeclaration: vi.fn() }));
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
  vi.mocked(loadCuratedDeclaration).mockResolvedValue(node);
  render(view());
  expect(await screen.findByText(/Declared fields available/)).toHaveTextContent('Loading dependencies');
  expect(screen.getByRole('heading', { name: 'Selected' })).toBeVisible();
  expect(screen.getByDisplayValue('own')).toBeDisabled();
  expect(screen.queryByText('Full workspace loading')).toBeNull();
});

it.each(['workspace', 'cohort', 'selection'])('discards an earlier result after a %s change', async (change) => {
  let finish!: (node: TypeGraphNode) => void;
  vi.mocked(loadCuratedDeclaration).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  vi.mocked(loadCuratedDeclaration).mockReturnValueOnce(new Promise(() => {}));
  const { rerender } = render(view());
  const signal = vi.mocked(loadCuratedDeclaration).mock.calls[0]![2];
  rerender(
    view(
      change === 'workspace' ? 'workspace-b' : 'workspace-a',
      change === 'cohort' ? { ...seed, key: 'key-b', version: 'b' } : seed,
      change === 'selection' ? 'example.selected.Other#Data' : node.id
    )
  );
  expect(signal.aborted).toBe(true);
  await act(async () => finish(node));
  expect(screen.getByText('Full workspace loading')).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Selected' })).toBeNull();
});

it('falls back to normal hydration on failure and yields when authoritative content arrives', async () => {
  vi.mocked(loadCuratedDeclaration).mockRejectedValueOnce(new Error('unavailable'));
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
  let finish!: (node: TypeGraphNode) => void;
  vi.mocked(loadCuratedDeclaration).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const { rerender } = render(view());
  const signal = vi.mocked(loadCuratedDeclaration).mock.calls[0]![2];
  rerender(
    <CuratedDeclarationInspector nodeId={node.id} scope="workspace-a" actions={actions} isHydrating={false}>
      <p>Authoritative Inspector</p>
    </CuratedDeclarationInspector>
  );
  await act(async () => finish(node));
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
  expect(loadCuratedDeclaration).not.toHaveBeenCalled();
});
