// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Daikonic contributors

import { act, render, screen } from '@testing-library/react';
import { memo, useContext, useState } from 'react';
import { expect, it, vi } from 'vitest';
import type { ReactFlowProps } from '@xyflow/react';
import type { FunctionComposition } from '@rune-langium/core';
import { CompositionCanvas } from '../../src/components/compose/CompositionCanvas.js';
import {
  NodeBindingContext,
  type ComposerNode,
  type NodeBindingActions
} from '../../src/components/compose/CompositionNode.js';

const harness = vi.hoisted(() => {
  const flow: ReactFlowProps<ComposerNode> = {};
  return {
    flow,
    layout: vi.fn(() => ({})),
    parent: vi.fn(),
    palette: vi.fn(),
    inspector: vi.fn(),
    node: vi.fn(),
    api: { getNode: vi.fn(), fitView: vi.fn(async () => true), setViewport: vi.fn() }
  };
});
vi.mock('@xyflow/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@xyflow/react')>()),
  useReactFlow: () => harness.api,
  useNodesInitialized: () => false,
  ReactFlow: (props: ReactFlowProps<ComposerNode>) => {
    harness.flow = props;
    return (
      <>
        {props.nodes?.map((node) => (
          <Probe key={node.id} data={node.data} />
        ))}
      </>
    );
  }
}));
vi.mock('@rune-langium/visual-editor', () => ({
  computeGraphPositions: harness.layout,
  formatCardinality: vi.fn(),
  parseCardinality: vi.fn()
}));
const Probe = memo(function Probe({ data }: { data: ComposerNode['data'] }) {
  useContext(NodeBindingContext);
  harness.node();
  return <span>{data.expression}</span>;
});

it('keeps pointer updates inside the canvas and preserves a draft position through semantic edits', () => {
  const composition: FunctionComposition = {
    optedIn: true,
    supported: true,
    reasons: [],
    steps: [
      { id: 'input:value', name: 'value', kind: 'input', dependencies: [] },
      { id: 'return', name: 'result', kind: 'return', dependencies: ['input:value'] }
    ]
  };
  const actions: NodeBindingActions = {
    owner: 'example',
    writable: true,
    busy: false,
    adding: false,
    variableName: '',
    variables: [],
    arguments: () => [],
    expression: () => '',
    editExpression: vi.fn(),
    select: vi.fn(),
    argument: vi.fn(),
    argumentMode: vi.fn(),
    value: vi.fn(),
    output: vi.fn(),
    name: vi.fn(),
    newOutput: vi.fn(),
    apply: vi.fn(),
    discard: vi.fn()
  };
  const moved = vi.fn();
  let editPreview: (expression: string) => void = () => {};
  function Parent() {
    harness.parent();
    harness.palette();
    harness.inspector();
    const [expression, setExpression] = useState('empty sort');
    const [focus, setFocus] = useState<string>();
    editPreview = setExpression;
    return (
      <NodeBindingContext.Provider value={actions}>
        <CompositionCanvas
          current={composition}
          presented={composition}
          source=""
          active
          vertical
          selected="draft:new"
          preview={{
            step: { id: 'draft:new', name: 'sorted', kind: 'expression', dependencies: [] },
            expression,
            position: { x: 100, y: 100 }
          }}
          variablesOpen
          viewKey="example:TB"
          size={{ width: 0, height: 0 }}
          focus={focus}
          setFocus={setFocus}
          positions={new Map()}
          viewports={new Map()}
          onSelect={vi.fn()}
          onDrop={vi.fn()}
          onConnect={vi.fn()}
          onDraftMove={moved}
        />
      </NodeBindingContext.Provider>
    );
  }
  render(<Parent />);
  expect(screen.getByText('empty sort')).toBeVisible();
  const before = {
    parent: harness.parent.mock.calls.length,
    palette: harness.palette.mock.calls.length,
    inspector: harness.inspector.mock.calls.length,
    node: harness.node.mock.calls.length,
    layout: harness.layout.mock.calls.length
  };
  for (let tick = 0; tick < 30; tick++)
    act(() =>
      harness.flow.onNodesChange?.([
        { id: 'draft:new', type: 'position', position: { x: 200 + tick, y: 300 + tick }, dragging: true }
      ])
    );
  expect(harness.flow.nodes?.find((node) => node.id === 'draft:new')?.position).toEqual({ x: 229, y: 329 });
  expect(harness.parent).toHaveBeenCalledTimes(before.parent);
  expect(harness.palette).toHaveBeenCalledTimes(before.palette);
  expect(harness.inspector).toHaveBeenCalledTimes(before.inspector);
  expect(harness.node).toHaveBeenCalledTimes(before.node);
  expect(harness.layout).toHaveBeenCalledTimes(before.layout);
  expect(moved).not.toHaveBeenCalled();
  // Selection can expand a source node while starting a connection. Its
  // measurement must not move the target out from under the user's pointer.
  act(() =>
    harness.flow.onConnectStart?.(new MouseEvent('mousedown'), {
      nodeId: 'input:value',
      handleId: 'output',
      handleType: 'source'
    })
  );
  act(() =>
    harness.flow.onNodesChange?.([{ id: 'input:value', type: 'dimensions', dimensions: { width: 280, height: 240 } }])
  );
  expect(harness.layout).toHaveBeenCalledTimes(before.layout);
  act(() =>
    harness.flow.onConnectEnd?.(new MouseEvent('mouseup'), {
      isValid: null,
      fromPosition: null,
      pointer: null,
      from: null,
      to: null,
      fromHandle: null,
      toHandle: null,
      fromNode: null,
      toNode: null,
      toPosition: null
    })
  );
  // A semantic edit must not reapply the original draft position.
  act(() => editPreview('values sort'));
  expect(screen.getByText('values sort')).toBeVisible();
  expect(harness.flow.nodes?.find((node) => node.id === 'draft:new')?.position).toEqual({ x: 229, y: 329 });
});
