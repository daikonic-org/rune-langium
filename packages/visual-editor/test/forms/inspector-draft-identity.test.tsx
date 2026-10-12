// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { afterEach, it, expect, vi } from 'vitest';
import { render, renderHook, screen, within, fireEvent, act, cleanup } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { useInspectorExternalSync } from '../../src/hooks/useInspectorExternalSync.js';
import { useStore } from 'zustand';
import { parse } from '@rune-langium/core';
import { DataTypeForm } from '../../src/components/editors/DataTypeForm.js';
import { EnumForm } from '../../src/components/editors/EnumForm.js';
import { FunctionForm } from '../../src/components/editors/FunctionForm.js';
import { ChoiceForm } from '../../src/components/editors/ChoiceForm.js';
import { loadInspectorFixture } from '../helpers/inspector-fixture.js';
import { createEditorCommitRegistry } from '../../src/hooks/editor-commit-lifecycle.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it.each(['deleted', 'ambiguous origin', 'ambiguous destination'])(
  'clears a %s member draft instead of retargeting another member',
  (scenario) => {
    const source = {
      attributes:
        scenario === 'ambiguous origin'
          ? [
              { name: 'alpha', definition: '' },
              { name: 'alpha', definition: '' }
            ]
          : [
              { name: 'alpha', definition: '' },
              { name: 'beta', definition: '' }
            ]
    };
    const { result, rerender } = renderHook(
      ({ source, epoch }) => {
        const form = useForm({ defaultValues: source });
        useInspectorExternalSync(form, source, (value) => value, { parseEpoch: epoch });
        return form;
      },
      { initialProps: { source, epoch: 1 } }
    );
    act(() => result.current.setValue('attributes.0.definition', 'Unsaved alpha', { shouldDirty: true }));
    const next = {
      attributes:
        scenario === 'deleted'
          ? [{ name: 'beta', definition: '' }]
          : scenario === 'ambiguous destination'
            ? [
                { name: 'alpha', definition: '' },
                { name: 'alpha', definition: '' }
              ]
            : [{ name: 'alpha', definition: '' }]
    };
    rerender({ source: next, epoch: 2 });
    expect(result.current.getValues()).toEqual(next);
    expect(result.current.formState.errors.root?.identity?.message).toMatch(/could not be uniquely matched/);
  }
);

it('follows a unique range before duplicate names within one parse epoch', () => {
  const source = {
    attributes: [
      { name: 'alpha', definition: '', $cstRange: { offset: 10, end: 20 } },
      { name: 'alpha', definition: '', $cstRange: { offset: 30, end: 40 } }
    ]
  };
  const { result, rerender } = renderHook(
    ({ source }) => {
      const form = useForm({ defaultValues: source });
      useInspectorExternalSync(form, source, (value) => value, { parseEpoch: 1 });
      return form;
    },
    { initialProps: { source } }
  );
  act(() => result.current.setValue('attributes.0.definition', 'First member', { shouldDirty: true }));
  rerender({ source: { attributes: [...source.attributes].reverse() } });
  expect(result.current.getValues('attributes.0.definition')).toBe('');
  expect(result.current.getValues('attributes.1.definition')).toBe('First member');
});

it('does not transfer a removed ranged member draft to a same-name replacement within its epoch', () => {
  const source = { attributes: [{ name: 'alpha', definition: '', $cstRange: { offset: 10, end: 20 } }] };
  const { result, rerender } = renderHook(
    ({ source }) => {
      const form = useForm({ defaultValues: source });
      useInspectorExternalSync(form, source, (value) => value, { parseEpoch: 1 });
      return form;
    },
    { initialProps: { source } }
  );
  act(() => result.current.setValue('attributes.0.definition', 'Removed member', { shouldDirty: true }));
  const replacement = { attributes: [{ name: 'alpha', definition: '', $cstRange: { offset: 30, end: 40 } }] };
  rerender({ source: replacement });
  expect(result.current.getValues()).toEqual(replacement);
  expect(result.current.formState.errors.root?.identity?.message).toMatch(/could not be uniquely matched/);
});
for (const kind of ['data', 'enum', 'func'] as const) {
  for (const pending of [false, true]) {
    it(`${kind} (${pending ? 'pending' : 'invalid'}) keeps a draft with its member when Source reparses reordered rows`, async () => {
      const declaration =
        kind === 'data'
          ? 'type Owner:\n  alpha string (1..1)\n  beta int (0..1)'
          : kind === 'enum'
            ? 'enum Owner:\n  alpha\n  beta'
            : 'func Owner:\n  inputs:\n    alpha string (1..1)\n    beta int (0..1)\n  output: result string (1..1)';
      const source = `namespace demo\nversion "1"\n${declaration}\n`;
      const { store, getNode } = await loadInspectorFixture(source);
      const id = getNode('Owner').id;
      function Fixture() {
        const state = useStore(store);
        const root = state.nodesById.get(id)!;
        const props = {
          nodeId: id,
          data: root.data,
          meta: root.meta,
          actions: state,
          allNodes: state.nodes,
          availableTypes: [],
          parseEpoch: state.parseEpoch
        };
        return kind === 'data' ? (
          <DataTypeForm {...props} />
        ) : kind === 'enum' ? (
          <EnumForm {...props} />
        ) : (
          <FunctionForm {...props} />
        );
      }
      vi.useFakeTimers();
      render(<Fixture />);
      const label = kind === 'enum' ? 'Value name for alpha' : 'Attribute name: alpha';
      fireEvent.change(screen.getByLabelText(label), { target: { value: pending ? 'renamed' : '' } });
      if (!pending) await act(async () => vi.advanceTimersByTime(600));
      const reordered = source.replace(
        kind === 'enum'
          ? '  alpha\n  beta'
          : kind === 'func'
            ? '    alpha string (1..1)\n    beta int (0..1)'
            : '  alpha string (1..1)\n  beta int (0..1)',
        kind === 'enum'
          ? '  beta\n  alpha'
          : kind === 'func'
            ? '    beta int (0..1)\n    alpha string (1..1)'
            : '  beta int (0..1)\n  alpha string (1..1)'
      );
      const parsed = await parse(reordered);
      expect(parsed.hasErrors).toBe(false);
      act(() => store.getState().loadModels(parsed.value));
      const draft =
        kind === 'enum'
          ? screen.getByLabelText(/Value name for (alpha|renamed)/)
          : screen.getByLabelText(pending ? 'Attribute name: renamed' : /^Attribute name:\s*$/);
      expect(draft).toHaveValue(pending ? 'renamed' : '');
      fireEvent.change(draft, { target: { value: 'renamed' } });
      await act(async () => vi.advanceTimersByTime(600));
      const field = kind === 'enum' ? 'enumValues' : kind === 'func' ? 'inputs' : 'attributes';
      expect(store.getState().captureMetadataTarget(id, [field, 0])?.expected).toMatchObject({ name: 'beta' });
      expect(store.getState().captureMetadataTarget(id, [field, 1])?.expected).toMatchObject({ name: 'renamed' });
      if (kind !== 'enum')
        expect(store.getState().captureMetadataTarget(id, [field, 1])?.expected).toMatchObject({
          typeCall: { type: { $refText: 'string' } },
          card: { inf: 1, sup: 1 }
        });
    });
  }
}

it('retries a valid root rename after temporary parse blocking', async () => {
  const { store, getNode } = await loadInspectorFixture();
  const id = getNode('Person').id;
  const registry = createEditorCommitRegistry();
  function Fixture({ blocked }: { blocked: boolean }) {
    const state = useStore(store);
    const node = state.nodesById.get(id)!;
    if (!node) return null;
    return (
      <DataTypeForm
        nodeId={id}
        data={node.data}
        meta={node.meta}
        actions={state}
        allNodes={state.nodes}
        availableTypes={[]}
        structuralEditsDisabled={blocked}
        registerCommitFlush={registry.register}
      />
    );
  }
  vi.useFakeTimers();
  const view = render(<Fixture blocked={false} />);
  fireEvent.change(screen.getByLabelText('Data type name'), { target: { value: 'Renamed' } });
  view.rerender(<Fixture blocked />);
  await act(async () => vi.advanceTimersByTime(600));
  expect(() => registry.flush()).toThrow(/waiting/);
  view.rerender(<Fixture blocked={false} />);
  expect(store.getState().nodes.some((node) => node.data.name === 'Renamed')).toBe(true);
});

it('keeps an invalid name local when an immediate cardinality control commits', async () => {
  const { store, getNode } = await loadInspectorFixture();
  const id = getNode('Person').id;
  function Fixture() {
    const state = useStore(store);
    const node = state.nodesById.get(id)!;
    return (
      <DataTypeForm
        nodeId={id}
        data={node.data}
        meta={node.meta}
        actions={state}
        allNodes={state.nodes}
        availableTypes={[]}
      />
    );
  }
  render(<Fixture />);
  fireEvent.change(screen.getByLabelText('Attribute name: name'), { target: { value: '' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Cardinality' })[0]!);
  fireEvent.click(screen.getByRole('option', { name: '0..1' }));
  expect(store.getState().captureMetadataTarget(id, ['attributes', 0])?.expected).toMatchObject({
    name: 'name',
    card: { inf: 0, sup: 1 }
  });
  expect(screen.getByLabelText(/^Attribute name:\s*$/)).toHaveValue('');
});

it.each(['data', 'func', 'enum'] as const)(
  '%s pending rename preserves newer Source signature/display',
  async (kind) => {
    const body =
      kind === 'enum'
        ? 'enum Owner:\n  alpha displayName "Old"'
        : kind === 'func'
          ? 'func Owner:\n  inputs:\n    alpha string (1..1)\n  output: result string (1..1)'
          : 'type Owner:\n  alpha string (1..1)';
    const source = `namespace demo\n${body}\n`;
    const { store, getNode } = await loadInspectorFixture(source);
    const id = getNode('Owner').id;
    function Fixture() {
      const state = useStore(store);
      const node = state.nodesById.get(id)!;
      const props = {
        nodeId: id,
        data: node.data,
        meta: node.meta,
        actions: state,
        allNodes: state.nodes,
        availableTypes: [],
        parseEpoch: state.parseEpoch
      };
      return kind === 'data' ? (
        <DataTypeForm {...props} />
      ) : kind === 'func' ? (
        <FunctionForm {...props} />
      ) : (
        <EnumForm {...props} />
      );
    }
    vi.useFakeTimers();
    render(<Fixture />);
    fireEvent.change(screen.getByLabelText(kind === 'enum' ? 'Value name for alpha' : 'Attribute name: alpha'), {
      target: { value: 'renamed' }
    });
    const parsed = await parse(
      source.replace(
        kind === 'enum' ? 'displayName "Old"' : 'alpha string (1..1)',
        kind === 'enum' ? 'displayName "New"' : 'alpha int (0..*)'
      )
    );
    expect(parsed.hasErrors).toBe(false);
    act(() => store.getState().loadModels(parsed.value));
    await act(async () => vi.advanceTimersByTime(600));
    const member = store
      .getState()
      .captureMetadataTarget(id, [
        kind === 'enum' ? 'enumValues' : kind === 'func' ? 'inputs' : 'attributes',
        0
      ])?.expected;
    expect(member).toMatchObject(
      kind === 'enum'
        ? { name: 'renamed', display: 'New' }
        : { name: 'renamed', typeCall: { type: { $refText: 'int' } }, card: { inf: 0, unbounded: true } }
    );
  }
);

it.each(['definition', 'annotation'] as const)(
  'retains a valid %s draft and rejects the save barrier during temporary blocking',
  async (field) => {
    const { store, getNode } = await loadInspectorFixture(
      'namespace demo\nannotation marking:\n  scheme string (1..1)\ntype Owner:\n  alpha string (1..1) [marking scheme "scheme"="ISIN"]\n'
    );
    const id = getNode('Owner').id;
    const registry = createEditorCommitRegistry();
    function Fixture({ blocked }: { blocked: boolean }) {
      const state = useStore(store);
      const node = state.nodesById.get(id)!;
      return (
        <DataTypeForm
          nodeId={id}
          data={node.data}
          meta={node.meta}
          actions={state}
          allNodes={state.nodes}
          availableTypes={[]}
          structuralEditsDisabled={blocked}
          registerCommitFlush={registry.register}
        />
      );
    }
    vi.useFakeTimers();
    const view = render(<Fixture blocked={false} />);
    fireEvent.focus(screen.getByLabelText('Attribute name: alpha'));
    if (field === 'annotation') fireEvent.click(screen.getByRole('button', { name: 'Edit marking annotation' }));
    const input = within(screen.getByRole('region', { name: 'Details: alpha' })).getByLabelText(
      field === 'definition' ? 'Definition' : 'Qualifier 1 value'
    );
    fireEvent.change(input, { target: { value: 'Pending' } });
    view.rerender(<Fixture blocked />);
    await act(async () => vi.advanceTimersByTime(600));
    expect(input.isConnected).toBe(true);
    expect(() => registry.flush()).toThrow(/waiting/);
    view.rerender(<Fixture blocked={false} />);
    act(() => registry.flush());
    expect(store.getState().captureMetadataTarget(id, ['attributes', 0])?.expected).toMatchObject(
      field === 'definition' ? { definition: 'Pending' } : { annotations: [{ qualifiers: [{ qualValue: 'Pending' }] }] }
    );
  }
);

it('keeps the selected rich annotation draft with its owner through a Source reorder', async () => {
  const source =
    'namespace demo\nannotation marking:\n  scheme string (1..1)\ntype Owner:\n  alpha string (1..1) [marking scheme "scheme"="ISIN"]\n  beta int (0..1)\n';
  const { store, getNode } = await loadInspectorFixture(source);
  const id = getNode('Owner').id;
  function Fixture() {
    const state = useStore(store);
    const node = state.nodesById.get(id)!;
    return (
      <DataTypeForm
        nodeId={id}
        data={node.data}
        meta={node.meta}
        actions={state}
        allNodes={state.nodes}
        availableTypes={[]}
        parseEpoch={state.parseEpoch}
      />
    );
  }
  render(<Fixture />);
  fireEvent.focus(screen.getByLabelText('Attribute name: alpha'));
  fireEvent.click(screen.getByRole('button', { name: 'Edit marking annotation' }));
  fireEvent.change(screen.getByLabelText('Qualifier 1 value'), { target: { value: 'Pending' } });
  const parsed = await parse(
    source.replace(
      '  alpha string (1..1) [marking scheme "scheme"="ISIN"]\n  beta int (0..1)',
      '  beta int (0..1)\n  alpha string (1..1) [marking scheme "scheme"="ISIN"]'
    )
  );
  expect(parsed.hasErrors).toBe(false);
  act(() => store.getState().loadModels(parsed.value));
  const details = within(screen.getByRole('region', { name: 'Details: alpha' }));
  const draft = details.getByLabelText('Qualifier 1 value');
  expect(draft).toHaveValue('Pending');
  fireEvent.change(draft, { target: { value: 'After reorder' } });
  fireEvent.blur(draft);
  expect(store.getState().captureMetadataTarget(id, ['attributes', 1])?.expected).toMatchObject({
    annotations: [{ qualifiers: [{ qualValue: 'After reorder' }] }]
  });
  expect(store.getState().captureMetadataTarget(id, ['attributes', 0])?.expected).toMatchObject({
    name: 'beta',
    annotations: []
  });
});

it('retains an incomplete Choice option qualifier draft through a harmless reparse', async () => {
  const source =
    'namespace demo\nannotation marking:\n  scheme string (1..1)\ntype Person:\n  name string (1..1)\nenum Role:\n  Member\nchoice Owner:\n  Person [marking scheme "scheme"="ISIN"]\n  Role\n';
  const { store, getNode } = await loadInspectorFixture(source);
  const id = getNode('Owner').id;
  function Fixture() {
    const state = useStore(store);
    const node = state.nodesById.get(id)!;
    return (
      <ChoiceForm
        nodeId={id}
        data={node.data}
        meta={node.meta}
        actions={state}
        allNodes={state.nodes}
        availableTypes={[]}
        parseEpoch={state.parseEpoch}
      />
    );
  }
  render(<Fixture />);
  fireEvent.focus(screen.getByRole('listitem', { name: 'Inspect Person' }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit marking annotation' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Value kind' }), { target: { value: 'path' } });
  const parsed = await parse(`${source}// Harmless source edit\n`);
  expect(parsed.hasErrors).toBe(false);
  act(() => store.getState().loadModels(parsed.value));
  const details = within(screen.getByRole('region', { name: 'Details: Person' }));
  expect(details.getByRole('combobox', { name: 'Value kind' })).toHaveValue('path');
  expect(details.getByRole('button', { name: 'Choose receiver type…' })).toBeVisible();
  expect(screen.queryByText(/A draft was cleared/)).toBeNull();
});
