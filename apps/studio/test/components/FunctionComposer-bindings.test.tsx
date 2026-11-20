// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Daikonic contributors
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { parse, type CompositionStep, type FunctionComposition } from '@rune-langium/core';
import type { NodeBindingActions } from '../../src/components/compose/CompositionNode.js';
import { FunctionComposer } from '../../src/components/compose/FunctionComposer.js';
import { ExpressionDocument } from '../../src/services/expression-document.js';

const harness = vi.hoisted((): { actions: NodeBindingActions | null } => ({ actions: null }));
const describeComposition = vi.hoisted(() => vi.fn());
vi.mock('../../src/services/workspace.js', async (original) => ({
  ...(await original<typeof import('../../src/services/workspace.js')>()),
  requestFunctionComposition: describeComposition,
  requestExpressionScope: vi.fn(async () => [])
}));
vi.mock('../../src/components/compose/CompositionCanvas.js', async () => {
  const { useContext } = await import('react');
  const { NodeBindingContext } = await import('../../src/components/compose/CompositionNode.js');
  return {
    DRAFT_NODE: 'draft',
    CompositionCanvas: () => {
      harness.actions = useContext(NodeBindingContext);
      return <div>Canvas binding surface</div>;
    }
  };
});
const actions = () => {
  if (!harness.actions) throw new Error('Canvas bindings are unavailable');
  return harness.actions;
};

it.each(['Canvas argument', 'collection', 'Source argument'])(
  'keeps nested call arguments editable across a collection rebind (starting with %s)',
  async (firstEdit) => {
    harness.actions = null;
    const expression = 'values /* keep collection trivia */ extract [Double( item )]';
    const source = `namespace example
func Owner:
 inputs:
  values number (0..*)
  replacement number (0..*)
 output: result number (0..*)
 alias scaled: ${expression}
 set result: scaled
`;
    const from = source.indexOf(expression);
    const argumentFrom = source.indexOf('item');
    const step: CompositionStep = {
      id: 'alias:scaled',
      name: 'scaled',
      kind: 'each',
      dependencies: ['input:values'],
      region: { from, to: from + expression.length },
      collection: { from, to: from + 'values'.length },
      locals: ['item'],
      call: {
        identity: 'example.Double',
        region: { from: source.indexOf('Double('), to: source.indexOf(' )]') + 2 },
        inputs: [{ name: 'value', type: 'number', cardinality: '(1..1)' }],
        arguments: [{ from: argumentFrom, to: argumentFrom + 'item'.length }]
      }
    };
    const facts: FunctionComposition = {
      optedIn: true,
      supported: true,
      reasons: [],
      steps: [
        ...['values', 'replacement'].map((name): CompositionStep => ({
          id: `input:${name}`,
          name,
          kind: 'input',
          dependencies: [],
          parameter: { name, type: 'number', cardinality: '(0..*)' }
        })),
        step,
        { id: 'return', name: 'result', kind: 'return', dependencies: [step.id] }
      ]
    };
    describeComposition.mockResolvedValue(facts);
    const file = { path: 'model/owner.rosetta', name: 'owner.rosetta', content: source, dirty: false };
    const onContentChange = vi.fn();
    const documents = new ExpressionDocument({ getGeneration: () => 1, getFile: () => file, onContentChange });
    const parsed = await parse(source);
    expect(parsed.parserErrors).toEqual([]);
    render(
      <FunctionComposer
        workspaceKey={`collection-binding-${firstEdit}`}
        models={[]}
        active
        inspector={null}
        onNavigate={vi.fn()}
        onSave={vi.fn(async () => {})}
        editor={{
          nodeId: 'example.Owner#RosettaFunction',
          file,
          parseCurrent: true,
          parsed: { filePath: file.path, source, model: parsed.value },
          documents,
          dependencySnapshot: [file],
          onContentChange,
          onOpenSource: vi.fn()
        }}
      />
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Canvas', exact: true }));
    await waitFor(() => expect(actions().writable).toBe(true));
    if (firstEdit === 'Canvas argument') act(() => actions().argument(step, 0, 'item + 1'));
    if (firstEdit === 'Source argument') {
      fireEvent.keyDown(await screen.findByRole('button', { name: 'Edit item', exact: true }), { key: 'i' });
      fireEvent.change(screen.getByRole('textbox', { name: 'Edit item', exact: true }), {
        target: { value: 'item + 1' }
      });
      fireEvent.click(screen.getByRole('button', { name: 'Done', exact: true }));
      expect(actions().expression(step)).toBe('values /* keep collection trivia */ extract [Double( item + 1 )]');
    }
    act(() => actions().value(step, 'replacement', 'input:replacement'));
    act(() => actions().argument(step, 0, '['));
    act(() => actions().argument(step, 0, 'item + 2'));
    expect(actions().arguments(step)[0]?.value).toBe('item + 2');
    expect(actions().expression(step)).toBe('replacement /* keep collection trivia */ extract [Double( item + 2 )]');
    await act(async () => actions().apply());
    expect(onContentChange).toHaveBeenCalledWith(
      file.path,
      source.replace(expression, 'replacement /* keep collection trivia */ extract [Double( item + 2 )]')
    );
  }
);
