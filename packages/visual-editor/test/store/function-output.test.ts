// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, expect, it } from 'vitest';
import { parse, isRosettaFunction, isMapOperation, isRosettaSymbolReference } from '@rune-langium/core';
import { renderModel } from '@rune-langium/codegen/rosetta';
import { createEditorStore } from '../../src/store/editor-store.js';
import { modelsToAst } from '../../src/adapters/model-to-ast.js';

const SOURCE = `namespace signature.edit
version "1.0.0"
func Example:
  inputs:
    values number (0..*)
  output:
    result number (0..*) <"Retain output documentation.">
  set result: values
  set result: result extract result [result + 1]
  post-condition Nonnegative: result count >= 0
`;

async function fixture(source = SOURCE) {
  const parsed = await parse(source);
  expect(parsed.hasErrors, JSON.stringify(parsed.parserErrors)).toBe(false);
  const store = createEditorStore();
  store.getState().loadModels(parsed.value);
  const id = store.getState().nodes.find((node) => node.data.name === 'Example')!.id;
  const text = () => {
    const state = store.getState();
    return renderModel(modelsToAst(state.nodes, state.edges)[0]!);
  };
  store.temporal.getState().clear();
  return { store, id, text };
}

describe('function output signature', () => {
  it('can display a partial source parse without requiring every symbol reference to exist', async () => {
    const parsed = await parse(`namespace signature.edit
      func Example:
        output: result number (1..1)
        set result:
    `);
    expect(parsed.hasErrors).toBe(true);
    const store = createEditorStore();
    expect(() => store.getState().loadModels(parsed.value)).not.toThrow();
  });

  it('renames assignment roots and output references, preserves lambda shadowing and supports one-step Undo', async () => {
    const { store, id, text } = await fixture();
    const before = text();
    store.getState().updateOutputParam(id, 'result', 'adjusted', 'number', '(1..*)');
    const edited = text();
    expect(edited).toContain('adjusted number (1..*)');
    expect(edited).toMatch(/set adjusted:\s+values/);
    expect(edited).toMatch(/set adjusted:\s+adjusted extract result \[result \+ 1\]/);
    expect(edited).toContain('adjusted count >= 0');
    expect(edited).toContain('Retain output documentation.');
    expect((await parse(edited)).hasErrors).toBe(false);
    store.temporal.getState().undo();
    expect(text()).toBe(before);
    store.temporal.getState().redo();
    expect(text()).toBe(edited);
  });

  it('preserves implicitly scoped inherited fields while renaming the output', async () => {
    const { store, id, text } = await fixture(`namespace signature.edit
      type Parent:
        result number (1..1)
      type Entry extends Parent:
        extra number (0..1)
      func Example:
        inputs: values Entry (0..*)
        output: result number (0..*)
        set result: values extract [result]
        post-condition Valid: result count >= 0
    `);
    store.getState().updateOutputParam(id, 'result', 'adjusted', 'number', '(0..*)');
    expect(text()).toContain('values extract [result]');
    expect(text()).toContain('adjusted count >= 0');
    const reparsed = await parse(text());
    const fn = reparsed.value.elements.find(isRosettaFunction)!;
    const map = fn.operations[0]!.expression;
    if (!isMapOperation(map) || !map.function || !isRosettaSymbolReference(map.function.body))
      throw new Error('Expected the implicit extraction');
    expect(map.function.body.symbol.ref?.$container).toBe(
      reparsed.value.elements.find((node) => node.name === 'Parent')
    );
    expect(fn.operations[0]!.assignRoot.ref).toBe(fn.output);
  });

  it('leaves a same-named callable bound to its function declaration', async () => {
    const { store, id, text } = await fixture(`namespace signature.edit
      func result:
        inputs: value number (1..1)
        output: answer number (1..1)
        set answer: value + 1
      func Example:
        output: result number (1..1)
        set result: result(1)
    `);
    store.getState().updateOutputParam(id, 'result', 'adjusted', 'number', '(1..1)');
    expect(text()).toContain('adjusted number (1..1)');
    expect(text()).toMatch(/set adjusted:\s+result\(1\)/);
  });

  it('rejects an unproven destination in an implicit output capture atomically', async () => {
    const { store, id, text } = await fixture(SOURCE.replace('extract result [result + 1]', 'extract [result count]'));
    const before = text();
    store.getState().updateOutputParam(id, 'result', 'adjusted', 'number', '(0..*)');
    expect(text()).toBe(before);
  });

  it('waits for fresh linked bindings after a pending expression edit', async () => {
    const { store, id, text } = await fixture();
    store.getState().updateExpression(id, 'result count', 0);
    const pending = text();
    store.getState().updateOutputParam(id, 'result', 'adjusted', 'number', '(0..*)');
    expect(text()).toBe(pending);
    const parsed = await parse(pending);
    store.getState().loadModels(parsed.value);
    store.getState().updateOutputParam(id, 'result', 'adjusted', 'number', '(0..*)');
    expect(text()).toMatch(/set adjusted:\s+adjusted count/);
  });

  it('rejects stale names, local collisions and capture without partially changing the graph', async () => {
    const { store, id, text } = await fixture(
      SOURCE.replace('extract result [result + 1]', 'extract selected [result count]')
    );
    const before = text();
    for (const [oldName, newName] of [
      ['stale', 'changed'],
      ['result', 'values'],
      ['result', 'selected']
    ]) {
      store.getState().updateOutputParam(id, oldName!, newName!, 'string', '(1..1)');
      expect(text()).toBe(before);
    }
  });

  it('updates output dependency edges and preserves signature metadata during a type-only edit', async () => {
    const { store, id } = await fixture(SOURCE + `\ntype Value:\n  amount number (1..1)\n`);
    const target = store.getState().nodes.find((node) => node.data.name === 'Value')!;
    store.getState().updateOutputParam(id, 'result', 'result', 'Value', '(0..1)', target.id);
    expect(store.getState().edges.filter((edge) => edge.source === id && edge.data?.label === 'output')).toMatchObject([
      { target: target.id }
    ]);
    store.getState().updateOutputType(id, 'string');
    const data = store.getState().nodesById.get(id)!.data;
    expect(data).toMatchObject({
      output: { name: 'result', card: { inf: 0, sup: 1 }, definition: 'Retain output documentation.' }
    });
    expect(store.getState().edges.filter((edge) => edge.source === id && edge.data?.label === 'output')).toHaveLength(
      0
    );
  });
});
