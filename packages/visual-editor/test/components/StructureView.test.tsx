// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StructureView } from '../../src/components/StructureView.js';
import type { AdapterDocument, AdapterNode } from '../../src/adapters/structure-graph-adapter.js';
import { expansionKey, type StructureExpansionKey } from '../../src/types/structure-view.js';

const attr = (name: string, type: string) => ({
  name,
  typeCall: { type: { $refText: type } },
  card: { inf: 0, sup: 1, unbounded: false }
});
const data = (name: string, attributes: ReturnType<typeof attr>[], extra: Partial<AdapterNode> = {}): AdapterNode => ({
  id: `demo.${name}`,
  $type: 'Data',
  name,
  namespace: 'demo',
  attributes,
  ...extra
});
const doc: AdapterDocument = {
  namespaces: [{ uri: 'demo' }],
  nodes: [
    data('Base', [attr('identifier', 'string')]),
    data('Address', [attr('city', 'string')]),
    data('Party', [attr('name', 'string'), attr('address', 'Address')], { extends: 'Base' }),
    data('Trade', [
      attr('buyer', 'Party'),
      attr('seller', 'Party'),
      attr('payment', 'Payment'),
      attr('amendments', 'Trade'),
      attr('status', 'Status')
    ]),
    {
      $type: 'Choice',
      id: 'demo.Payment',
      name: 'Payment',
      namespace: 'demo',
      choiceOptions: [{ typeCall: 'Address' }, { typeCall: 'Trade' }]
    },
    {
      $type: 'Enum',
      id: 'demo.Status',
      name: 'Status',
      namespace: 'demo',
      values: Array.from({ length: 12 }, (_, i) => ({ name: `Value${i}` }))
    }
  ]
};
const card = (container: HTMLElement, id: string) =>
  container.querySelector<HTMLElement>(`[data-canonical-id="${id}"].rune-structure-card`)!;
const key = (typeId: string, attrName: string, instancePath: readonly string[]): StructureExpansionKey => ({
  namespaceUri: 'demo',
  typeId,
  attrName,
  instancePath
});
afterEach(() => vi.useRealTimers());

describe('Structure document', () => {
  it('shows the empty, unsupported and stale states', () => {
    const result = render(<StructureView focusedTypeId={undefined} adapterDoc={undefined} />);
    expect(screen.getByTestId('structure-empty-state')).toHaveTextContent('Select a type');
    result.rerender(
      <StructureView
        focusedTypeId={undefined}
        adapterDoc={doc}
        unsupportedSelectedType={{ name: 'Alias', kind: 'Type alias' }}
      />
    );
    expect(screen.getByTestId('structure-unsupported-kind-state')).toHaveTextContent('Alias');
    result.rerender(<StructureView focusedTypeId="demo.Deleted" adapterDoc={doc} />);
    expect(screen.getByTestId('structure-unsupported-root-state')).toHaveTextContent('no longer available');
  });

  it('renders a semantic hierarchy without React Flow or transformed text', () => {
    const { container } = render(<StructureView focusedTypeId="demo.Trade" adapterDoc={doc} />);
    expect(screen.getByRole('region', { name: 'Type structure' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Trade' })).toBeInTheDocument();
    expect(card(container, 'demo.Trade').querySelector('ol')).toBeInTheDocument();
    expect(container.querySelector('.react-flow')).toBeNull();
    expect(container.querySelector('[style*="transform"]')).toBeNull();
    expect(card(container, 'demo.Party')).toBeNull();
  });

  it('toggles canonical instance keys and nests inherited/derived content inside the owner row', () => {
    const toggle = vi.fn();
    const expanded = new Map([[expansionKey(key('Trade', 'buyer', ['demo.Trade'])), true]]);
    const { container } = render(
      <StructureView focusedTypeId="demo.Trade" adapterDoc={doc} expansionMap={expanded} onToggleExpansion={toggle} />
    );
    const buyer = screen.getByRole('button', { name: 'Collapse buyer' });
    const child = buyer.closest('li')!.querySelector('.rune-structure-member__child')!;
    expect(child).toContainElement(card(container, 'demo.Party'));
    expect(child).toHaveTextContent('Inherited');
    expect(child).toHaveTextContent('identifier');
    expect(screen.getByRole('button', { name: 'Expand seller' })).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(buyer);
    expect(toggle).toHaveBeenCalledWith(key('Trade', 'buyer', ['demo.Trade']));
  });

  it('keeps repeated type instances independent through nested inheritance', () => {
    const toggle = vi.fn();
    const expanded = new Map(
      ['buyer', 'seller'].map((name) => [expansionKey(key('Trade', name, ['demo.Trade'])), true])
    );
    render(
      <StructureView focusedTypeId="demo.Trade" adapterDoc={doc} expansionMap={expanded} onToggleExpansion={toggle} />
    );
    const addresses = screen.getAllByRole('button', { name: 'Expand address' });
    fireEvent.click(addresses[0]!);
    fireEvent.click(addresses[1]!);
    const paths = toggle.mock.calls.map(([arg]) => arg.instancePath);
    expect(paths[0]).not.toEqual(paths[1]);
    expect(paths[0]).toContain('demo.Trade');
    expect(paths[0].at(-1)).toContain('buyer');
    expect(paths[1].at(-1)).toContain('seller');
  });

  it('stops a recursive branch without hiding its navigation', () => {
    const expanded = new Map([[expansionKey(key('Trade', 'amendments', ['demo.Trade'])), true]]);
    render(
      <StructureView
        focusedTypeId="demo.Trade"
        adapterDoc={doc}
        expansionMap={expanded}
        onNavigateToEnumType={vi.fn()}
      />
    );
    expect(screen.getByText('Reference already shown in this branch.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Navigate to Trade' })).toBeInTheDocument();
    expect(screen.getAllByRole('region', { name: 'Trade' })).toHaveLength(1);
  });

  it('renders choices, toggles arms, and renders long enum disclosures', () => {
    const toggle = vi.fn();
    const inspect = vi.fn();
    const result = render(<StructureView focusedTypeId="demo.Payment" adapterDoc={doc} onToggleExpansion={toggle} />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand Address' }));
    expect(toggle).toHaveBeenCalledWith(key('Payment', 'Address', ['demo.Payment']));
    result.rerender(<StructureView focusedTypeId="demo.Status" adapterDoc={doc} onInspectType={inspect} />);
    expect(screen.getByText('Value7')).toBeInTheDocument();
    expect(screen.queryByText('Value8')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View all 12 values' }));
    expect(inspect).toHaveBeenCalledWith('demo.Status');
  });

  it('keeps injected editors, readonly inherited cells and canonical header selection', () => {
    const name = vi.fn(({ value }: { value: string }) => <span>{value}</span>);
    const type = vi.fn(({ typeName }: { typeName: string }) => <span>{typeName}</span>);
    const cardCell = vi.fn(({ value }: { value: string }) => <span>{value}</span>);
    const select = vi.fn();
    render(
      <StructureView
        focusedTypeId="demo.Party"
        adapterDoc={doc}
        cellComponents={{ name, type, card: cardCell }}
        onNodeSelect={select}
      />
    );
    expect(name.mock.calls.map(([props]) => props.value)).toEqual(['name', 'address']);
    fireEvent.click(screen.getByRole('button', { name: 'Party', exact: true }));
    expect(select).toHaveBeenLastCalledWith('demo.Party');
    fireEvent.click(screen.getByRole('button', { name: 'Base', exact: true }));
    expect(select).toHaveBeenLastCalledWith('demo.Base');
    expect(type).toHaveBeenCalled();
    expect(cardCell).toHaveBeenCalled();
  });

  it('avoids re-rendering cells on unrelated host renders', () => {
    const name = vi.fn(({ value }: { value: string }) => <span>{value}</span>);
    const cells = { name };
    const result = render(<StructureView focusedTypeId="demo.Trade" adapterDoc={doc} cellComponents={cells} />);
    const before = name.mock.calls.length;
    result.rerender(<StructureView focusedTypeId="demo.Trade" adapterDoc={doc} cellComponents={cells} />);
    expect(name).toHaveBeenCalledTimes(before);
  });

  it('supports reference context actions and keyboard reachable function references', () => {
    const navigate = vi.fn();
    const inspect = vi.fn();
    const funcDoc: AdapterDocument = {
      ...doc,
      nodes: [
        ...doc.nodes,
        {
          $type: 'Function',
          id: 'demo.Resolve',
          name: 'Resolve',
          namespace: 'demo',
          inputs: [attr('trade', 'Trade')],
          output: attr('result', 'Party')
        }
      ]
    };
    render(
      <StructureView
        focusedTypeId="demo.Resolve"
        adapterDoc={funcDoc}
        onNavigateToEnumType={navigate}
        onInspectType={inspect}
      />
    );
    const input = screen.getByRole('button', { name: 'Navigate to Trade' });
    input.focus();
    fireEvent.click(input);
    expect(navigate).toHaveBeenCalledWith('demo.Trade');
    const output = screen.getByRole('button', { name: 'Navigate to Party' });
    output.focus();
    fireEvent.keyDown(output, { key: 'F10', shiftKey: true });
    expect(screen.getByRole('menuitem', { name: 'Inspect type' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Inspect type' }));
    expect(inspect).toHaveBeenCalledWith('demo.Party');
  });

  it('keeps inspect-only references keyboard reachable and restores menu focus', () => {
    const inspect = vi.fn();
    render(<StructureView focusedTypeId="demo.Trade" adapterDoc={doc} onInspectType={inspect} />);
    const ref = screen.getByRole('group', { name: 'buyer type Party' });
    ref.focus();
    fireEvent.keyDown(ref, { key: 'F10', shiftKey: true });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Inspect type' }));
    expect(inspect).toHaveBeenCalledWith('demo.Party');
    expect(ref).toHaveFocus();
  });

  it('moves only the document root by keyboard and resets without losing expansion', () => {
    const result = render(<StructureView focusedTypeId="demo.Trade" adapterDoc={doc} />);
    const stage = card(result.container, 'demo.Trade');
    const move = stage.querySelector('header')!;
    fireEvent.keyDown(move, { key: 'ArrowRight' });
    expect(stage.style.translate).toBe('8px 0px');
    fireEvent.keyDown(move, { key: 'ArrowDown', shiftKey: true });
    expect(stage.style.translate).toBe('8px 32px');
    fireEvent.click(screen.getByRole('button', { name: 'Reset layout' }));
    expect(stage.style.translate).toBe('0px 0px');
    expect(screen.getByRole('button', { name: 'Expand buyer' })).toBeInTheDocument();
    fireEvent.keyDown(move, { key: 'ArrowRight' });
    result.rerender(<StructureView focusedTypeId="demo.Address" adapterDoc={doc} />);
    expect(card(result.container, 'demo.Address').style.translate).toBe('0px 0px');
  });

  it('retains timed navigation cues across temporary missing data', () => {
    vi.useFakeTimers();
    const result = render(<StructureView focusedTypeId="demo.Trade" adapterDoc={doc} navigationRevision={1} />);
    act(() => vi.advanceTimersByTime(350));
    expect(card(result.container, 'demo.Trade')).toHaveClass('rune-navigation-arrival');
    expect(screen.getByTestId('structure-view-flow')).not.toHaveClass('rune-navigation-arrival');
    act(() => vi.advanceTimersByTime(1100));
    result.rerender(<StructureView focusedTypeId="demo.Trade" adapterDoc={undefined} navigationRevision={1} />);
    result.rerender(<StructureView focusedTypeId="demo.Trade" adapterDoc={doc} navigationRevision={1} />);
    act(() => vi.advanceTimersByTime(350));
    expect(card(result.container, 'demo.Trade')).not.toHaveClass('rune-navigation-arrival');
    result.rerender(<StructureView focusedTypeId="demo.Trade" adapterDoc={doc} navigationRevision={2} />);
    act(() => vi.advanceTimersByTime(350));
    expect(card(result.container, 'demo.Trade')).toHaveClass('rune-navigation-arrival');
    expect(screen.getByTestId('structure-view-flow')).not.toHaveClass('rune-navigation-arrival');
    result.rerender(<StructureView focusedTypeId="demo.Party" adapterDoc={doc} navigationRevision={3} />);
    act(() => vi.advanceTimersByTime(350));
    expect(card(result.container, 'demo.Party')).toHaveClass('rune-navigation-arrival');
    const inherited = result.container.querySelector<HTMLElement>('.rune-structure-card[data-kind="base"]')!;
    expect(inherited).toContainElement(card(result.container, 'demo.Party'));
    expect(inherited).not.toHaveClass('rune-navigation-arrival');
  });
});
