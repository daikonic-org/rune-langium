// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { parseWorkspace } from '@rune-langium/core';
import { useEditorStore } from '@rune-langium/visual-editor';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceTypePicker } from '../../src/components/WorkspaceTypePicker.js';

const WORKSPACE_SOURCES = [
  {
    uri: 'test/one.rosetta',
    content: `
namespace test.one
version "1.0.0"

type Party:
  name string (1..1)
func Party:
  output: result string (1..1)
`
  },
  {
    uri: 'test/two.rosetta',
    content: `
namespace test.two
version "1.0.0"

type Party:
  identifier string (1..1)

choice Role:
  Party
`
  }
];

afterEach(() => {
  useEditorStore.setState({
    nodes: [],
    nodesById: new Map(),
    edges: [],
    edgesById: new Map(),
    selectedNodeId: null,
    deferredExports: []
  });
});

describe('WorkspaceTypePicker', () => {
  it('searches qualified workspace entries and delegates selection without changing Explore selection', async () => {
    const parsed = await parseWorkspace(WORKSPACE_SOURCES);
    useEditorStore.getState().loadModels(parsed.map((result) => result.value));
    const onSelect = vi.fn();
    const user = userEvent.setup();

    render(
      <WorkspaceTypePicker value={null} onSelect={onSelect} filterKinds={['data', 'choice']} label="Instance type" />
    );

    await user.click(screen.getByRole('button', { name: /^Instance type/ }));
    await user.type(await screen.findByRole('combobox', { name: 'Search instance type' }), 'Party');
    await user.click(screen.getByRole('option', { name: /Party.*test\.two/ }));

    expect(onSelect).toHaveBeenCalledWith('test.two.Party');
    expect(useEditorStore.getState().selectedNodeId).toBeNull();
  });

  it('focuses its search input and supports Escape, Enter, and clearing', async () => {
    const parsed = await parseWorkspace(WORKSPACE_SOURCES);
    useEditorStore.getState().loadModels(parsed.map((result) => result.value));
    const onSelect = vi.fn();
    const user = userEvent.setup();

    render(
      <WorkspaceTypePicker
        value="test.one.Party"
        onSelect={onSelect}
        filterKinds={['data', 'choice']}
        allowClear
        label="Instance type"
      />
    );

    await user.click(screen.getByRole('button', { name: /^Instance type/ }));
    const input = await screen.findByRole('combobox', { name: 'Search instance type' });
    expect(input).toHaveFocus();
    await act(async () => {
      await user.keyboard('{Escape}');
    });
    await waitFor(() => expect(screen.queryByRole('combobox')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /^Instance type/ }));
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onSelect).toHaveBeenCalledWith('test.one.Party');

    await user.click(screen.getByRole('button', { name: /^Instance type/ }));
    await user.click(await screen.findByRole('option', { name: 'Clear selection' }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it('uses the allowed declaration kind when a type and function share an FQN', async () => {
    const parsed = await parseWorkspace(WORKSPACE_SOURCES);
    useEditorStore.getState().loadModels(parsed.map((result) => result.value));
    const onSelectOption = vi.fn();
    const user = userEvent.setup();

    render(
      <WorkspaceTypePicker
        value="test.one.Party"
        onSelect={vi.fn()}
        onSelectOption={onSelectOption}
        filterKinds={['func']}
        label="Function"
      />
    );

    expect(screen.getByRole('button', { name: 'Function: Party — test.one' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: /^Function/ }));
    await user.keyboard('{ArrowDown}{Enter}');

    expect(onSelectOption).toHaveBeenCalledWith(
      expect.objectContaining({ value: 'test.one.Party#RosettaFunction', kind: 'func' })
    );
  });
});
