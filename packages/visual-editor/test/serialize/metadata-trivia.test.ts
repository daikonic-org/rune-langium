// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { it, expect, vi } from 'vitest';
import * as core from '@rune-langium/core';
import { parse } from '@rune-langium/core';
import { loadInspectorFixture } from '../helpers/inspector-fixture.js';
import { buildSourceForNamespaces } from '../../src/hooks/useModelSourceSync.js';

it.each(['\n', '\r\n'])('moves authored child trivia with a renamed/reordered metadata owner (%j)', async (newline) => {
  const text =
    'namespace demo.forms\nversion "1"\n\nannotation marking:\n  scheme string (1..1)\n\ntype Person:\n  // name owner 🧭\n  name /* internal owner */ string (1..1) // inline owner\n  age int (0..1)\n\nfunc Identity:\n  inputs:\n    value string (1..1)\n  output:\n    result string (1..1)\n  set result:\n    value // untouched function\n';
  const source = text.replaceAll('\n', newline);
  const { store, getNode } = await loadInspectorFixture(source);
  const id = getNode('Person').id;
  store.getState().applyMetadataCommand(store.getState().captureMetadataTarget(id, ['attributes', 0])!, {
    kind: 'definition',
    value: 'Full name'
  });
  store.getState().updateAttribute(id, 'name', 'fullName', 'string', '(1..1)');
  store.getState().reorderAttribute(id, 0, 1);
  const state = store.getState();
  const output = buildSourceForNamespaces({
    nodes: state.nodes,
    edges: state.edges,
    originalSourceByNamespace: new Map([['demo.forms', source]]),
    patches: state.pendingEditPatches,
    inversePatches: state.pendingInversePatches
  }).get('demo.forms')!;
  for (const comment of ['name owner 🧭', 'internal owner', 'inline owner'])
    expect(output.split(comment)).toHaveLength(2);
  expect(output.indexOf('// name owner 🧭')).toBeGreaterThan(output.indexOf('age int'));
  expect(output.slice(output.indexOf('func Identity:'))).toBe(source.slice(source.indexOf('func Identity:')));
  expect((await parse(output)).hasErrors).toBe(false);
  if (newline === '\r\n') expect(output.replaceAll('\r\n', '')).not.toContain('\n');
});

it('moves the last member inline comment rather than leaving it on its replacement', async () => {
  const source =
    'namespace demo.forms\nversion "1"\ntype Person:\n  name string (1..1)\n  age int (0..1) // age owner\n';
  const { store, getNode } = await loadInspectorFixture(source);
  store.getState().reorderAttribute(getNode('Person').id, 1, 0);
  const state = store.getState();
  const output = buildSourceForNamespaces({
    nodes: state.nodes,
    edges: state.edges,
    originalSourceByNamespace: new Map([['demo.forms', source]]),
    patches: state.pendingEditPatches,
    inversePatches: state.pendingInversePatches
  }).get('demo.forms')!;
  expect(output).toMatch(/age int[^\n]*\/\/ age owner/);
  expect(output.split('age owner')).toHaveLength(2);
});

it('removes deleted child trivia while retaining sibling and parent comments', async () => {
  const source =
    'namespace demo.forms\nversion "1"\ntype Person:\n  // name owner\n  name string (1..1) // inline name\n\n// parent note\n\n  // age owner\n  age int (0..1)\n';
  const { store, getNode } = await loadInspectorFixture(source);
  store.getState().removeAttribute(getNode('Person').id, 'name');
  const state = store.getState();
  const output = buildSourceForNamespaces({
    nodes: state.nodes,
    edges: state.edges,
    originalSourceByNamespace: new Map([['demo.forms', source]]),
    patches: state.pendingEditPatches,
    inversePatches: state.pendingInversePatches
  }).get('demo.forms')!;
  expect(output).not.toContain('name owner');
  expect(output).not.toContain('inline name');
  expect(output.split('age owner')).toHaveLength(2);
  expect(output.split('parent note')).toHaveLength(2);
  expect((await parse(output)).hasErrors).toBe(false);
});

it('retains rich metadata, labels and rule refs through edits, undo and reparse', async () => {
  const source = `namespace demo.forms
version "1"
synonym source FpML
annotation marking:
  scheme string (1..1)
type Person:
  [synonym FpML value "Person" tag 2 path "p" meta "meta" maps 3]
  // child owner
  name string (1..1)
    [marking scheme "scheme"="ISIN" "path"=Person -> child -> name]
    [synonym FpML value "personName" tag 4 path "name" maps 2, "extra" meta "meta" dateFormat "yyyy" pattern "a" "b" removeHtml mapper "custom"]
    [label "Full name"]
    [ruleReference empty]
  age int (0..1) // last age owner
  child Person (0..1)

enum Role:
  Manager displayName "Account manager"
    [synonym FpML value "M" definition "manager" pattern "a" "b" removeHtml]
`;
  const { store, getNode } = await loadInspectorFixture(source);
  const { authoredValuesEqual } = await import('../../src/store/edit-reconcile.js');
  const { getMetadataItems } = await import('../../src/store/metadata-ops.js');
  const person = getNode('Person');
  const id = person.id;
  const emit = () => {
    const state = store.getState();
    return buildSourceForNamespaces({
      nodes: state.nodes,
      edges: state.edges,
      originalSourceByNamespace: new Map([['demo.forms', source]]),
      patches: state.pendingEditPatches,
      inversePatches: state.pendingInversePatches
    }).get('demo.forms')!;
  };
  expect(emit()).toBe(source);
  store.getState().applyMetadataCommand(store.getState().captureMetadataTarget(id, ['attributes', 0])!, {
    kind: 'definition',
    value: 'New documentation'
  });
  const target = store.getState().captureMetadataTarget(id, ['attributes', 0])!;
  const original = getMetadataItems(target.expected, 'annotations')[0]!;
  if (original.$type !== 'AnnotationRef') throw new Error('Wrong annotation fixture');
  store.getState().applyMetadataCommand(target, {
    kind: 'replace',
    field: 'annotations',
    index: 0,
    expected: original,
    value: {
      ...original,
      qualifiers: original.qualifiers.map((q) => (q.qualName === 'scheme' ? { ...q, qualValue: 'SEDOL' } : q))
    }
  });
  const output = emit();
  expect(output).toContain('"path"=Person -> child -> name');
  expect(output).toContain('"scheme"="SEDOL"');
  for (const retained of [
    '[label "Full name"]',
    '[ruleReference empty]',
    'mapper "custom"',
    'meta "meta" maps 3',
    'definition "manager" pattern "a" "b" removeHtml',
    '// last age owner'
  ])
    expect(output).toContain(retained);
  const parsed = await parse(output);
  expect(parsed.hasErrors).toBe(false);
  store.getState().loadModels(parsed.value);
  const caughtUp = store.getState().captureMetadataTarget(id, ['attributes', 0])!;
  expect(caughtUp.expected.definition).toBe('New documentation');
  expect(
    authoredValuesEqual(
      getMetadataItems(caughtUp.expected, 'annotations')[0],
      getMetadataItems(target.expected, 'annotations')[0]
    )
  ).toBe(false);
  const actual = parsed.value.elements.find((node) => node.$type === 'Data');
  if (!actual || actual.$type !== 'Data') throw new Error('Missing data');
  expect(actual.attributes[0]!.synonyms[0]!.body.mapper).toBe('custom');
  const fresh = await loadInspectorFixture(source);
  fresh.store.getState().removeAttribute(fresh.getNode('Person').id, 'age');
  fresh.store.temporal.getState().undo();
  const state = fresh.store.getState();
  const undone = buildSourceForNamespaces({
    nodes: state.nodes,
    edges: state.edges,
    originalSourceByNamespace: new Map([['demo.forms', source]]),
    patches: state.pendingEditPatches,
    inversePatches: state.pendingInversePatches
  }).get('demo.forms')!;
  expect(undone).toBe(source);
});

it('deleting the last child removes its outside-CST inline tail without disturbing the next declaration', async () => {
  const source =
    'namespace demo.forms\ntype Person:\n  name string (1..1)\n  age int (0..1) // age owner\n\n// next declaration owner\ntype Other:\n  value string (1..1) // other tail\n';
  const { store, getNode } = await loadInspectorFixture(source);
  store.getState().removeAttribute(getNode('Person').id, 'age');
  const state = store.getState();
  const output = buildSourceForNamespaces({
    nodes: state.nodes,
    edges: state.edges,
    originalSourceByNamespace: new Map([['demo.forms', source]]),
    patches: state.pendingEditPatches,
    inversePatches: state.pendingInversePatches
  }).get('demo.forms')!;
  expect(output).not.toContain('age owner');
  expect(output.slice(output.indexOf('// next declaration owner'))).toBe(
    source.slice(source.indexOf('// next declaration owner'))
  );
});

it('uses no trivia scan for clean declarations and one canonical scan for a changed namespace', async () => {
  const { store, source, getNode } = await loadInspectorFixture();
  const spy = vi.spyOn(core, 'getSourceComments');
  try {
    const emit = () => {
      const s = store.getState();
      return buildSourceForNamespaces({
        nodes: s.nodes,
        edges: s.edges,
        originalSourceByNamespace: new Map([['demo.forms', source]]),
        patches: s.pendingEditPatches,
        inversePatches: s.pendingInversePatches
      });
    };
    emit();
    expect(spy).not.toHaveBeenCalled();
    store
      .getState()
      .applyMetadataCommand(store.getState().captureMetadataTarget(getNode('Person').id, ['attributes', 0])!, {
        kind: 'definition',
        value: 'Documentation'
      });
    emit();
    expect(spy).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});
