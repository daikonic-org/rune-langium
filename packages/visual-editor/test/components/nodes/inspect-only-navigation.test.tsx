// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { DataNode } from '../../../src/components/nodes/DataNode.js';
import { ChoiceNode } from '../../../src/components/nodes/ChoiceNode.js';
import { GenericNode } from '../../../src/components/nodes/GenericNode.js';
import { NavigationContext } from '../../../src/components/nodes/NavigationContext.js';

const targetId = 'context.Other#Data';
const typeCall = { type: { $refText: 'Other' } };
const fixtures = [
  {
    name: 'Data member',
    Component: DataNode,
    data: { $type: 'Data', name: 'Example', attributes: [{ name: 'other', typeCall }] }
  },
  {
    name: 'Choice option',
    Component: ChoiceNode,
    data: { $type: 'Choice', name: 'Example', attributes: [{ typeCall }] }
  },
  {
    name: 'Generic member',
    Component: GenericNode,
    data: { $type: 'Annotation', name: 'Example', attributes: [{ name: 'other', typeCall }] }
  },
  {
    name: 'Generic parent',
    Component: GenericNode,
    data: { $type: 'RosettaRecordType', name: 'Example', superType: { $refText: 'Other' } }
  },
  {
    name: 'Function output',
    Component: GenericNode,
    data: { $type: 'RosettaFunction', name: 'Example', inputs: [], output: { name: 'result', typeCall } }
  }
];

describe.each(fixtures)('$name context actions', ({ Component, data }) => {
  it.each(['inspect', 'navigate', 'both'] as const)('exposes a resolved reference with %s callbacks', async (mode) => {
    const navigate = vi.fn();
    const inspect = vi.fn();
    render(
      <ReactFlowProvider>
        <NavigationContext.Provider
          value={{
            allNodeIds: new Set([targetId]),
            layoutDirection: 'TB',
            pendingHydrationNamespaces: [],
            onNavigateToType: mode === 'inspect' ? undefined : navigate,
            onInspectType: mode === 'navigate' ? undefined : inspect
          }}
        >
          <Component data={data as any} id="context.Example" type="data" />
        </NavigationContext.Provider>
      </ReactFlowProvider>
    );
    const reference = screen.getByRole('button', { name: 'Other', exact: true });
    fireEvent.click(reference);
    expect(inspect).not.toHaveBeenCalled();
    if (mode === 'inspect') expect(navigate).not.toHaveBeenCalled();
    else expect(navigate).toHaveBeenCalledExactlyOnceWith(targetId);
    reference.focus();
    fireEvent.keyDown(reference, { key: 'F10', shiftKey: true });
    const action = mode === 'navigate' ? 'Go to type' : 'Inspect type';
    fireEvent.click(await screen.findByRole('menuitem', { name: action, exact: true }));
    expect(mode === 'navigate' ? navigate : inspect).toHaveBeenLastCalledWith(targetId);
    expect(reference).toHaveFocus();
  });
});

describe.each(['Record', 'TypeAlias'] as const)('static Structure %s keyboard actions', (kind) => {
  it.each(['data', 'choice'] as const)('makes a terminal reference reachable in a %s node', async (ownerKind) => {
    const inspect = vi.fn();
    const Component = ownerKind === 'data' ? DataNode : ChoiceNode;
    const row = {
      attrName: 'value',
      typeName: 'Other',
      typeKind: kind,
      targetNodeId: targetId,
      cardinality: '0..1',
      isOptional: true,
      isInherited: false
    };
    const data = {
      id: 'context.Example',
      name: 'Example',
      namespaceUri: 'context',
      variant: 'structure',
      kind: ownerKind,
      rows: [row],
      options: [row],
      expansions: new Map()
    };
    render(
      <ReactFlowProvider>
        <NavigationContext.Provider
          value={{
            allNodeIds: new Set([targetId]),
            layoutDirection: 'TB',
            pendingHydrationNamespaces: [],
            onInspectType: inspect
          }}
        >
          <Component data={data as any} id="context.Example" type={ownerKind} />
        </NavigationContext.Provider>
      </ReactFlowProvider>
    );
    const reference = screen.getByRole('group', { name: ownerKind === 'data' ? 'value: Other' : 'Other' });
    expect(reference).toHaveAttribute('tabindex', '0');
    reference.focus();
    fireEvent.keyDown(reference, { key: 'ContextMenu' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Inspect type', exact: true }));
    expect(inspect).toHaveBeenCalledExactlyOnceWith(targetId);
    expect(reference).toHaveFocus();
    expect(screen.queryByRole('button', { name: /^Expand/ })).not.toBeInTheDocument();
  });
});
