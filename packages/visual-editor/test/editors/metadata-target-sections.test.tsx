// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { act, fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorFormProvider } from '../../src/components/forms/EditorFormProvider.js';
import { MetadataSection } from '../../src/components/editors/MetadataSection.js';
import { AnnotationSection } from '../../src/components/editors/AnnotationSection.js';
import {
  MetadataTargetProvider,
  useMetadataBinding
} from '../../src/components/forms/metadata/MetadataTargetContext.js';
import { useInspectorSelection } from '../../src/components/forms/metadata/useInspectorSelection.js';
import { EditorActionsProvider } from '../../src/components/forms/sections/EditorActionsContext.js';
import { SCHEMA_BY_TYPE } from '../../src/schemas/schema-by-type.js';
import { loadInspectorFixture } from '../helpers/inspector-fixture.js';
import type { z } from 'zod';
import { createEditorCommitRegistry } from '../../src/hooks/editor-commit-lifecycle.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('shared metadata controls at child paths', () => {
  it('uses the parent form and commits the original child when selection changes before debounce', async () => {
    const { store, getNode } = await loadInspectorFixture();
    const root = getNode('Person');
    function Fixture() {
      const form = useForm({ defaultValues: root.data });
      const [active, setActive] = useState(0);
      const rows = [0, 1].map((index) => ({
        key: `row-${index}`,
        name: index === 0 ? 'name' : 'age',
        inherited: false,
        path: ['attributes', index] as const,
        node: store.getState().captureMetadataTarget(root.id, ['attributes', index])!.expected
      }));
      const selection = useInspectorSelection('workspace:person', rows);
      const binding = useMetadataBinding({
        scopeKey: 'workspace:person',
        nodeId: root.id,
        root: root.data,
        row: rows[active],
        selection,
        actions: store.getState()
      });
      return (
        <EditorFormProvider {...form} schema={SCHEMA_BY_TYPE.Data as z.ZodObject}>
          <EditorActionsProvider nodeId={root.id} actions={store.getState()}>
            <button onClick={() => setActive(1)}>Select age</button>
            <MetadataTargetProvider value={binding}>
              <MetadataSection key={active} />
            </MetadataTargetProvider>
          </EditorActionsProvider>
        </EditorFormProvider>
      );
    }
    vi.useFakeTimers();
    render(<Fixture />);
    fireEvent.change(screen.getByLabelText('Definition'), { target: { value: 'Full name' } });
    fireEvent.click(screen.getByText('Select age'));
    await act(async () => vi.advanceTimersByTime(500));
    expect(store.getState().captureMetadataTarget(root.id, ['attributes', 0])?.expected).toMatchObject({
      definition: 'Full name'
    });
    expect(store.getState().captureMetadataTarget(root.id, ['attributes', 1])?.expected).not.toHaveProperty(
      'definition'
    );
    expect(getNode('Person').data).not.toHaveProperty('definition');
    expect(screen.queryByLabelText('Comments')).not.toBeInTheDocument();
  });
  it('inspects inherited metadata without registering an ancestor in the local form', async () => {
    const { store, getNode } = await loadInspectorFixture();
    const root = getNode('Employee');
    const ancestor = store.getState().captureMetadataTarget(getNode('Person').id, ['attributes', 0])!.expected;
    const before = store.getState().pendingEditPatches;
    function Fixture() {
      const form = useForm({ defaultValues: root.data });
      const row = { key: 'inherited', name: 'name', inherited: true, readonlyNode: ancestor };
      const selection = useInspectorSelection('inherited', [row]);
      const binding = useMetadataBinding({
        scopeKey: 'inherited',
        nodeId: root.id,
        root: root.data,
        row,
        selection,
        actions: store.getState()
      });
      return (
        <EditorFormProvider {...form} schema={SCHEMA_BY_TYPE.Data as z.ZodObject}>
          <EditorActionsProvider nodeId={root.id} actions={store.getState()}>
            <MetadataTargetProvider value={binding}>
              <MetadataSection />
              <AnnotationSection />
            </MetadataTargetProvider>
          </EditorActionsProvider>
        </EditorFormProvider>
      );
    }
    render(<Fixture />);
    expect(screen.queryByRole('textbox', { name: 'Definition' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add annotation' })).toBeNull();
    expect(store.getState().pendingEditPatches).toBe(before);
  });
});

it('edits rich annotation qualifiers repeatedly without losing untouched arguments', async () => {
  const { store, getNode } = await loadInspectorFixture(
    'namespace demo.forms\nversion "1"\nannotation marking:\n  scheme string (1..1)\ntype Person:\n  name string (1..1)\n'
  );
  const root = getNode('Person');
  const { createAnnotationDraft } = await import('../../src/store/metadata-ops.js');
  const annotation = createAnnotationDraft('marking', 'scheme', [
    { $type: 'AnnotationQualifier', qualName: 'scheme', qualValue: 'ISIN' },
    {
      $type: 'AnnotationQualifier',
      qualName: 'path',
      qualPath: {
        $type: 'RosettaAttributeReference',
        receiver: { $type: 'RosettaDataReference', data: { $refText: 'demo.forms.Person' } },
        attribute: { $refText: 'name' }
      }
    }
  ]);
  store.getState().applyMetadataCommand(store.getState().captureMetadataTarget(root.id, ['attributes', 0])!, {
    kind: 'append',
    field: 'annotations',
    value: annotation
  });
  const node = getNode('Person');
  function Fixture() {
    const form = useForm({ defaultValues: node.data });
    const row = {
      key: 'name',
      name: 'name',
      inherited: false,
      path: ['attributes', 0] as const,
      node: store.getState().captureMetadataTarget(root.id, ['attributes', 0])!.expected
    };
    const selection = useInspectorSelection('rich', [row]);
    const binding = useMetadataBinding({
      scopeKey: 'rich',
      nodeId: root.id,
      root: node.data,
      row,
      selection,
      actions: store.getState()
    });
    return (
      <EditorFormProvider {...form} schema={SCHEMA_BY_TYPE.Data as z.ZodObject}>
        <EditorActionsProvider nodeId={root.id} actions={store.getState()} allNodes={store.getState().nodes}>
          <MetadataTargetProvider value={binding}>
            <AnnotationSection />
          </MetadataTargetProvider>
        </EditorActionsProvider>
      </EditorFormProvider>
    );
  }
  render(<Fixture />);
  fireEvent.click(screen.getByRole('button', { name: /Edit marking annotation/ }));
  const value = screen.getByLabelText('Qualifier 1 value');
  fireEvent.change(value, { target: { value: 'CUSIP' } });
  fireEvent.blur(value);
  fireEvent.change(value, { target: { value: 'SEDOL' } });
  fireEvent.blur(value);
  expect(store.getState().captureMetadataTarget(root.id, ['attributes', 0])?.expected).toMatchObject({
    annotations: [
      {
        attribute: { $refText: 'scheme' },
        qualifiers: [
          { qualName: 'scheme', qualValue: 'SEDOL' },
          { qualPath: { receiver: { data: { $refText: 'demo.forms.Person' } }, attribute: { $refText: 'name' } } }
        ]
      }
    ]
  });
});

it('continues a rich item edit after its own source reparse', async () => {
  const { parse } = await import('@rune-langium/core');
  const before =
    'namespace demo.forms\nversion "1"\nannotation marking:\n  scheme string (1..1)\ntype Person:\n  name string (1..1) [marking scheme "scheme"="ISIN"]\n';
  const { store, getNode } = await loadInspectorFixture(before);
  const root = getNode('Person');
  const registry = createEditorCommitRegistry();
  function Fixture() {
    const form = useForm({ defaultValues: root.data });
    const row = {
      key: 'name',
      name: 'name',
      inherited: false,
      path: ['attributes', 0] as const,
      node: store.getState().captureMetadataTarget(root.id, ['attributes', 0])!.expected
    };
    const selection = useInspectorSelection('reparse', [row]);
    const binding = useMetadataBinding({
      scopeKey: 'reparse',
      nodeId: root.id,
      root: root.data,
      row,
      selection,
      actions: store.getState()
    });
    return (
      <EditorFormProvider {...form} schema={SCHEMA_BY_TYPE.Data as z.ZodObject} registerCommitFlush={registry.register}>
        <EditorActionsProvider nodeId={root.id} actions={store.getState()} allNodes={store.getState().nodes}>
          <MetadataTargetProvider value={binding}>
            <AnnotationSection />
          </MetadataTargetProvider>
        </EditorActionsProvider>
      </EditorFormProvider>
    );
  }
  render(<Fixture />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit marking annotation' }));
  const value = screen.getByLabelText('Qualifier 1 value');
  fireEvent.change(value, { target: { value: 'SEDOL' } });
  fireEvent.blur(value);
  const parsed = await parse(before.replace('ISIN', 'SEDOL'));
  act(() => store.getState().loadModels(parsed.value));
  fireEvent.change(value, { target: { value: 'CUSIP' } });
  act(() => registry.flush());
  expect(store.getState().captureMetadataTarget(root.id, ['attributes', 0])?.expected).toMatchObject({
    annotations: [{ qualifiers: [{ qualValue: 'CUSIP' }] }]
  });
});

it('uses imported linked annotation scope even with a foreign duplicate name', async () => {
  const { parseWorkspace } = await import('@rune-langium/core');
  const { createEditorStore } = await import('../../src/store/editor-store.js');
  const models = await parseWorkspace([
    {
      uri: 'memory:///ui-scope-owner.rosetta',
      content:
        'namespace ui.owner\nimport ui.selected.*\ntype Owner:\n  name string (1..1) [marking scheme "scheme"="ISIN"]\n'
    },
    {
      uri: 'memory:///ui-scope-selected.rosetta',
      content: 'namespace ui.selected\nannotation marking:\n  scheme string (1..1)\n'
    },
    {
      uri: 'memory:///ui-scope-other.rosetta',
      content: 'namespace ui.other\nannotation marking:\n  foreignScheme string (1..1)\n'
    }
  ]);
  const store = createEditorStore();
  store.getState().loadModels(models.map((model) => model.value));
  const root = store.getState().nodes.find((node) => node.data.name === 'Owner')!;
  function Fixture() {
    const form = useForm({ defaultValues: root.data });
    const row = {
      key: 'name',
      name: 'name',
      inherited: false,
      path: ['attributes', 0] as const,
      node: store.getState().captureMetadataTarget(root.id, ['attributes', 0])!.expected
    };
    const selection = useInspectorSelection('scope', [row]);
    const binding = useMetadataBinding({
      scopeKey: 'scope',
      nodeId: root.id,
      root: root.data,
      row,
      selection,
      actions: store.getState()
    });
    return (
      <EditorFormProvider {...form} schema={SCHEMA_BY_TYPE.Data as z.ZodObject}>
        <EditorActionsProvider nodeId={root.id} actions={store.getState()} allNodes={store.getState().nodes}>
          <MetadataTargetProvider value={binding}>
            <AnnotationSection />
          </MetadataTargetProvider>
        </EditorActionsProvider>
      </EditorFormProvider>
    );
  }
  render(<Fixture />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit marking annotation' }));
  expect(screen.queryByText('Annotation scope unavailable.')).toBeNull();
  expect(screen.getByRole('button', { name: 'scheme', exact: true })).toBeEnabled();
});
