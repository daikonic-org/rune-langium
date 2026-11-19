// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Daikonic contributors

import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { createEditorStore, selectNodeRepository } from '@rune-langium/visual-editor';
import { FunctionPalette, COMPOSITION_FUNCTION_MIME } from '../../src/components/compose/FunctionPalette.js';
import type { ComponentProps } from 'react';

// jsdom has no layout; browser coverage exercises the real virtual viewport.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ index, key: index, start: index * 28, size: 28 })),
    getTotalSize: () => count * 28
  })
}));

function repository(groups: { namespace: string; functions: string[] }[]) {
  const store = createEditorStore();
  store.getState().loadDeferredExports(
    groups.map(({ namespace, functions }) => ({
      namespace,
      filePath: `${namespace}.rosetta`,
      exports: [
        ...functions.map((name) => ({ name, type: 'RosettaFunction' as const })),
        { name: 'HiddenData', type: 'Data' },
        { name: 'HiddenEnum', type: 'RosettaEnumeration' },
        { name: 'HiddenAlias', type: 'RosettaTypeAlias' }
      ]
    }))
  );
  store.getState().loadModels([]);
  return selectNodeRepository(store.getState().nodesById);
}

function props(
  overrides: Partial<ComponentProps<typeof FunctionPalette>> = {}
): ComponentProps<typeof FunctionPalette> {
  return {
    compositionIds: new Set(),
    repository: repository([{ namespace: 'cdm.rates', functions: ['Accrue', 'Rate'] }]),
    query: '',
    canAdd: true,
    onOpen: vi.fn(),
    onAdd: vi.fn(),
    ...overrides
  };
}

it('embeds a function-only namespace explorer and preserves collapse state across search', () => {
  const initial = props();
  const { rerender } = render(<FunctionPalette {...initial} />);
  const tree = screen.getByTestId('namespace-explorer');
  expect(within(tree).queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByTestId('kind-filter-pills')).not.toBeInTheDocument();
  expect(screen.queryByTestId('namespace-explorer-count')).not.toBeInTheDocument();
  expect(screen.queryByText('HiddenData')).not.toBeInTheDocument();
  expect(screen.queryByText('HiddenEnum')).not.toBeInTheDocument();
  expect(screen.queryByText('HiddenAlias')).not.toBeInTheDocument();
  const namespace = screen.getByTestId('ns-seg-cdm.rates');
  fireEvent.click(within(namespace).getByRole('button', { name: 'cdm.rates', exact: true }));
  expect(screen.queryByRole('button', { name: 'Open Accrue cdm.rates' })).not.toBeInTheDocument();
  rerender(<FunctionPalette {...initial} query="accrue" />);
  expect(screen.getByRole('button', { name: 'Open Accrue cdm.rates' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Open Rate cdm.rates' })).not.toBeInTheDocument();
  rerender(<FunctionPalette {...initial} query="" />);
  expect(screen.queryByRole('button', { name: 'Open Accrue cdm.rates' })).not.toBeInTheDocument();
});

it('searches the entire deferred inventory, without the old 100-function cutoff', () => {
  const initial = props({
    repository: repository([{ namespace: 'cdm.rates', functions: Array.from({ length: 125 }, (_, i) => `Rate${i}`) }])
  });
  const { rerender } = render(<FunctionPalette {...initial} />);
  expect(screen.getAllByRole('button', { name: /^Open Rate/ })).toHaveLength(125);
  expect(screen.getByRole('button', { name: 'Open Rate124 cdm.rates', exact: true })).toBeVisible();
  rerender(<FunctionPalette {...initial} query="rate124" />);
  expect(screen.getAllByRole('button', { name: /^Open Rate/ })).toHaveLength(1);
});
it('retains a focused row when its signature description arrives', () => {
  const initial = props();
  const { rerender } = render(<FunctionPalette {...initial} />);
  const button = screen.getAllByRole('button', { name: /^Open / })[0]!;
  button.focus();
  const identity = button.getAttribute('data-testid')!.replace('ns-type-link-', '').replace('#RosettaFunction', '');
  rerender(
    <FunctionPalette
      {...initial}
      callables={[{ identity, documentation: 'Updated function description', inputs: [], accepts: {} }]}
    />
  );
  expect(document.activeElement).toBe(button);
  expect(button).toHaveAccessibleName('Open Accrue cdm.rates');
  expect(button).toHaveAccessibleDescription('Updated function description');
});

it('reveals asynchronously loaded functions and distinguishes identical names by namespace', () => {
  const initial = props({ repository: repository([]), query: 'accrue' });
  const { rerender } = render(<FunctionPalette {...initial} />);
  expect(screen.queryByRole('button', { name: /^Open / })).not.toBeInTheDocument();
  rerender(
    <FunctionPalette
      {...initial}
      repository={repository([
        { namespace: 'cdm.rates', functions: ['Accrue'] },
        { namespace: 'example.loan', functions: ['Accrue'] }
      ])}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Open Accrue example.loan' }));
  expect(initial.onOpen).toHaveBeenCalledWith('example.loan.Accrue#RosettaFunction');
  expect(screen.getByRole('button', { name: 'Open Accrue cdm.rates' })).toBeVisible();
});

it('searches namespaces, signatures and documentation and keeps contextual suggestions', () => {
  const initial = props({
    query: 'RateSchedule',
    portContext: 'input:schedule',
    callables: [
      {
        identity: 'cdm.rates.Accrue',
        documentation: 'Floating coupon amount',
        inputs: [{ name: 'schedule', type: 'RateSchedule', cardinality: '1..1' }],
        output: { name: 'result', type: 'number', cardinality: '1..1' },
        accepts: { 'input:schedule': ['schedule'] }
      }
    ]
  });
  const { rerender } = render(<FunctionPalette {...initial} />);
  expect(screen.getByRole('button', { name: 'Open Accrue cdm.rates' })).toHaveAttribute(
    'title',
    expect.stringContaining('schedule: RateSchedule 1..1')
  );
  fireEvent.click(screen.getByRole('button', { name: 'Add suggested Accrue cdm.rates' }));
  expect(initial.onAdd).toHaveBeenCalledWith('cdm.rates.Accrue#RosettaFunction');
  rerender(<FunctionPalette {...initial} query="floating coupon" />);
  expect(screen.getByRole('button', { name: 'Open Accrue cdm.rates' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Open Rate cdm.rates' })).not.toBeInTheDocument();
  rerender(<FunctionPalette {...initial} query="cdm.rates" />);
  expect(screen.getByRole('button', { name: 'Open Rate cdm.rates' })).toBeVisible();
});

it('keeps opening, adding and dragging separate, with the canonical function identity', () => {
  const initial = props();
  render(<FunctionPalette {...initial} />);
  const row = screen.getByTestId('ns-type-cdm.rates.Accrue#RosettaFunction');
  fireEvent.click(screen.getByRole('button', { name: 'Add Accrue' }));
  expect(initial.onAdd).toHaveBeenCalledWith('cdm.rates.Accrue#RosettaFunction');
  expect(initial.onOpen).not.toHaveBeenCalled();
  const dataTransfer = { setData: vi.fn(), effectAllowed: '' };
  fireEvent.dragStart(row, { dataTransfer });
  expect(dataTransfer.setData).toHaveBeenCalledWith(COMPOSITION_FUNCTION_MIME, 'cdm.rates.Accrue#RosettaFunction');
  expect(dataTransfer.effectAllowed).toBe('copy');
  expect(initial.onAdd).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Open Accrue cdm.rates' }));
  expect(initial.onOpen).toHaveBeenCalledWith('cdm.rates.Accrue#RosettaFunction');
});

it('keeps read-only definitions browsable while disabling calls and row dragging', () => {
  const initial = props({ canAdd: false });
  render(<FunctionPalette {...initial} />);
  expect(screen.getByRole('button', { name: 'Add Accrue' })).toBeDisabled();
  expect(screen.getByTestId('ns-type-cdm.rates.Accrue#RosettaFunction')).toHaveAttribute('draggable', 'false');
  fireEvent.click(screen.getByRole('button', { name: 'Open Accrue cdm.rates' }));
  expect(initial.onOpen).toHaveBeenCalledWith('cdm.rates.Accrue#RosettaFunction');
  expect(initial.onAdd).not.toHaveBeenCalled();
});
