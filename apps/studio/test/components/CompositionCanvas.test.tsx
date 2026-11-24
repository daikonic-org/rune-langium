// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Daikonic contributors

import { act, fireEvent, render, screen } from '@testing-library/react';
import { memo, useContext, useState, type ComponentProps } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { NodeChangeset, type ReactFlowProps } from '@xyflow/react';
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
    initialized: false,
    layout: vi.fn(() => ({})),
    parent: vi.fn(),
    palette: vi.fn(),
    inspector: vi.fn(),
    node: vi.fn(),
    api: { setViewport: vi.fn(async () => true) }
  };
});
vi.mock('@xyflow/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@xyflow/react')>()),
  useReactFlow: () => harness.api,
  useNodesInitialized: () => harness.initialized,
  ReactFlow: (props: ReactFlowProps<ComposerNode>) => {
    harness.flow = props;
    return (
      <div onDrop={props.onDrop} aria-label="Test composition canvas">
        {props.nodes?.map((node) => (
          <Probe key={node.id} data={node.data} />
        ))}
      </div>
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

beforeEach(() => {
  vi.clearAllMocks();
  harness.initialized = false;
});

function cameraProps(): ComponentProps<typeof CompositionCanvas> {
  const composition: FunctionComposition = {
    optedIn: true,
    supported: true,
    reasons: [],
    steps: [{ id: 'return', name: 'result', kind: 'return', dependencies: [] }]
  };
  return {
    current: composition,
    presented: composition,
    source: '',
    active: true,
    vertical: true,
    selected: 'return',
    variablesOpen: false,
    viewKey: 'example:TB',
    size: { width: 900, height: 600 },
    onGraphElement: vi.fn(),
    setFocus: vi.fn(),
    positions: new Map(),
    viewports: new Map(),
    onSelect: vi.fn(),
    onDraftMove: vi.fn(),
    onConnect: vi.fn(),
    onDrop: vi.fn()
  };
}

it('restores the saved camera on mount and after navigating away and back', () => {
  harness.initialized = true;
  const props = cameraProps();
  const saved = { x: 120, y: -80, zoom: 0.6 };
  props.viewports.set(props.viewKey, { viewport: saved, width: props.size.width });
  const mounted = render(<CompositionCanvas {...props} />);
  expect(props.onGraphElement).toHaveBeenLastCalledWith(mounted.container.firstElementChild);
  expect(harness.api.setViewport).toHaveBeenLastCalledWith(saved);
  expect(props.setFocus).not.toHaveBeenCalled();

  const moved = { x: -300, y: 250, zoom: 0.8 };
  act(() => harness.flow.onMoveEnd?.(null, moved));
  mounted.unmount();
  expect(props.onGraphElement).toHaveBeenLastCalledWith(null);
  render(<CompositionCanvas {...props} />);
  expect(harness.api.setViewport).toHaveBeenLastCalledWith(moved);
  expect(props.setFocus).not.toHaveBeenCalled();
});

it('preserves the saved camera through initial measurement and only refocuses on a real resize', () => {
  harness.initialized = true;
  const props = { ...cameraProps(), variablesOpen: true };
  const saved = { x: 100, y: 200, zoom: 0.75 };
  props.viewports.set(props.viewKey, { viewport: saved, width: props.size.width });
  const { rerender } = render(<CompositionCanvas {...props} size={{ width: 0, height: 0 }} />);
  rerender(<CompositionCanvas {...props} />);
  expect(harness.api.setViewport).toHaveBeenLastCalledWith(saved);
  expect(props.setFocus).not.toHaveBeenCalled();

  rerender(<CompositionCanvas {...props} size={{ width: 750, height: 600 }} />);
  expect(props.setFocus).toHaveBeenCalledExactlyOnceWith('return');
});

it('keeps explicit focus ahead of a saved camera and fits new functions without a saved camera', () => {
  harness.initialized = true;
  const props = cameraProps();
  props.viewports.set(props.viewKey, { viewport: { x: 100, y: 200, zoom: 0.75 }, width: props.size.width });
  const mounted = render(<CompositionCanvas {...props} focus="return" />);
  expect(harness.api.setViewport).not.toHaveBeenCalled();
  expect(props.setFocus).not.toHaveBeenCalled();
  mounted.unmount();

  props.viewports.clear();
  render(<CompositionCanvas {...props} />);
  expect(harness.api.setViewport).not.toHaveBeenCalled();
  expect(props.setFocus).toHaveBeenCalledExactlyOnceWith('*');
});

it('ignores initial and repeated node measurements but refocuses a resized selected node', () => {
  harness.initialized = true;
  const props = { ...cameraProps(), variablesOpen: true };
  props.viewports.set(props.viewKey, { viewport: { x: 100, y: 200, zoom: 0.75 }, width: props.size.width });
  render(<CompositionCanvas {...props} />);
  const measure = (height: number) =>
    act(() =>
      harness.flow.onNodesChange?.(
        new NodeChangeset([{ id: 'return', type: 'dimensions', dimensions: { width: 280, height } }])
      )
    );
  measure(240);
  measure(240);
  expect(props.setFocus).not.toHaveBeenCalled();
  measure(300);
  expect(props.setFocus).toHaveBeenCalledExactlyOnceWith('return');
});

it('keeps the camera steady when a dropped Output expands on selection', () => {
  harness.initialized = true;
  const position = { x: 294, y: 30 };
  const props = {
    ...cameraProps(),
    variablesOpen: true,
    onDrop: vi.fn<ComponentProps<typeof CompositionCanvas>['onDrop']>((_, placeNode) => {
      placeNode('return', position);
    })
  };
  props.viewports.set(props.viewKey, { viewport: { x: -214, y: 30, zoom: 1 }, width: props.size.width });
  const { rerender } = render(<CompositionCanvas {...props} selected="" />);
  const measure = (height: number) =>
    act(() =>
      harness.flow.onNodesChange?.(
        new NodeChangeset([{ id: 'return', type: 'dimensions', dimensions: { width: 280, height } }])
      )
    );
  measure(82);
  fireEvent.drop(screen.getByLabelText('Test composition canvas'));
  rerender(<CompositionCanvas {...props} />);
  measure(110);

  expect(props.setFocus).not.toHaveBeenCalled();
  expect(harness.flow.nodes?.find((node) => node.id === 'return')?.position).toEqual(position);
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
  const onGraphElement = vi.fn();
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
          onGraphElement={onGraphElement}
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
      harness.flow.onNodesChange?.(
        new NodeChangeset([
          { id: 'draft:new', type: 'position', position: { x: 200 + tick, y: 300 + tick }, dragging: true }
        ])
      )
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
    harness.flow.onNodesChange?.(
      new NodeChangeset([{ id: 'input:value', type: 'dimensions', dimensions: { width: 280, height: 240 } }])
    )
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
