// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse, isData } from '@rune-langium/core';
import { DataTypeForm } from '../../src/components/editors/DataTypeForm.js';
import { createEditorStore } from '../../src/store/editor-store.js';
import { buildSourceForNamespaces } from '../../src/hooks/useModelSourceSync.js';
import baseline from './__snapshots__/dataform-roundtrip.json';

const source = readFileSync(resolve(import.meta.dirname, '../fixtures/forms-baseline.rosetta'), 'utf8');

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('pinned Data form round-trip contract', () => {
  for (const fixture of baseline.cases) {
    it(`preserves ${fixture.name} fields and committed values through source round-trip`, async () => {
      const parsed = await parse(source);
      expect(parsed.hasErrors).toBe(false);
      const store = createEditorStore();
      store.getState().loadModels(parsed.value);
      const node = store.getState().nodes.find((node) => node.data.name === fixture.name)!;
      expect(node).toBeDefined();
      store.getState().updateComments(node.id, fixture.comments);
      vi.useFakeTimers();

      const { container } = render(
        <DataTypeForm
          nodeId={node.id}
          data={node.data}
          meta={node.meta}
          actions={store.getState()}
          availableTypes={[]}
          allNodes={store.getState().nodes}
        />
      );
      expect(screen.getByLabelText('Data type name')).toHaveValue(fixture.name);
      const rows = container.querySelectorAll('[data-slot="attribute-row"]');
      expect(rows).toHaveLength(fixture.attributes.length);
      for (let index = 0; index < rows.length; index++) {
        expect(rows[index]!.querySelector('input')).toHaveValue(fixture.attributes[index]);
      }

      fireEvent.click(screen.getByRole('tab', { name: 'Doc' }));
      fireEvent.change(container.querySelector('[data-slot="metadata-description"]')!, {
        target: { value: fixture.definition }
      });
      expect(container.querySelector('[data-slot="metadata-comments"]')).toBeNull();
      await act(async () => vi.advanceTimersByTime(500));
      // An empty name must neither rename the node nor discard its metadata.
      fireEvent.change(screen.getByLabelText('Data type name'), { target: { value: '' } });
      await act(async () => vi.advanceTimersByTime(500));
      expect(screen.getByLabelText('Data type name')).toHaveAttribute('aria-invalid', 'true');
      expect(store.getState().nodes.find((candidate) => candidate.id === node.id)?.data.name).toBe(fixture.name);
      fireEvent.change(screen.getByLabelText('Data type name'), { target: { value: fixture.renamed } });
      await act(async () => vi.advanceTimersByTime(500));

      const state = store.getState();
      const edited = state.nodes.find((candidate) => candidate.data.name === fixture.renamed)!;
      expect(edited.data.definition).toBe(fixture.definition);
      expect(edited.meta.comments).toBe(fixture.comments);
      const output = buildSourceForNamespaces({
        nodes: state.nodes,
        edges: state.edges,
        originalSourceByNamespace: new Map([['demo.forms', source]]),
        patches: state.pendingEditPatches,
        inversePatches: state.pendingInversePatches
      }).get('demo.forms')!;
      vi.useRealTimers();
      const reparsed = await parse(output);
      expect(reparsed.hasErrors).toBe(false);
      const data = reparsed.value.elements.find((element) => isData(element) && element.name === fixture.renamed);
      expect(data && isData(data) && data.attributes.map((attribute) => attribute.name)).toEqual(fixture.attributes);
      expect(data?.definition).toBe(fixture.definition);
      if ('parent' in fixture && data && isData(data)) expect(data.superType?.$refText).toBe(fixture.parent);
      // The unrelated enum/choice/function/alias declarations must survive.
      expect(reparsed.value.elements.map((element) => ('name' in element ? element.name : undefined))).toEqual(
        expect.arrayContaining(['RoleEnum', 'PersonOrRole', 'ResolveEmployee', 'EmployeeIdAlias'])
      );
    });
  }
});
