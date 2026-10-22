// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { expect, it, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { InstanceInspectorPanel } from '../../src/shell/panels/InstanceInspectorPanel.js';
import { WorkspaceStateContext, type WorkspaceState } from '../../src/shell/providers/workspace-context.js';
import { PreviewSessionContext } from '../../src/shell/providers/preview-session-context.js';
import type { FormPreviewSchema } from '@rune-langium/codegen/export';

vi.mock('../../src/components/WorkspaceTypePicker.js', () => ({
  WorkspaceTypePicker: ({
    value,
    onSelectOption
  }: {
    value: string | null;
    onSelectOption?: (option: unknown) => void;
  }) => (
    <button
      onClick={() => onSelectOption?.({ value: 'example.Double#RosettaFunction', label: 'Double', kind: 'func' })}
    >
      {value ?? 'Choose calculation'}
    </button>
  )
}));
afterEach(cleanup);
const schema: FormPreviewSchema = {
  schemaVersion: 1,
  targetId: 'example.Double',
  title: 'Double',
  status: 'ready',
  kind: 'function',
  fields: [{ path: 'amount', label: 'Amount', kind: 'number', required: true }],
  result: { path: 'result', label: 'Result', kind: 'number', required: true },
  sourceMap: []
};
const files = [{ name: 'a.rosetta', path: 'a.rosetta', content: 'namespace example', dirty: false }];
const workspace: WorkspaceState = {
  workspaceId: 'a',
  workspaceEpoch: 1,
  fileCount: 1,
  files,
  models: [],
  parsedModels: [],
  deferredExports: [],
  parseErrors: new Map()
};

it.each(['id', 'epoch'] as const)(
  'clears workflow inputs and results at the workspace %s boundary even with identical files',
  async (boundary) => {
    const execute = vi.fn(async (_fqn: string, data: Record<string, unknown>) => Number(data.amount) * 2);
    const dispose = vi.fn();
    const factory = () => ({
      schema: vi.fn(async () => schema),
      execute,
      validate: vi.fn(async () => []),
      project: vi.fn(),
      dispose
    });
    const view = (state: WorkspaceState) => (
      <WorkspaceStateContext value={state}>
        <PreviewSessionContext value={factory}>
          <InstanceInspectorPanel />
        </PreviewSessionContext>
      </WorkspaceStateContext>
    );
    const { rerender } = render(view(workspace));
    fireEvent.click(screen.getByRole('button', { name: 'Choose calculation' }));
    fireEvent.change(await screen.findByRole('spinbutton', { name: 'Amount' }), { target: { value: '12' } });
    const run = screen.getByRole('button', { name: 'Execute', exact: true });
    await waitFor(() => expect(run).toBeEnabled());
    fireEvent.click(run);
    await waitFor(() => expect(screen.getByRole('region', { name: 'result output' })).toHaveTextContent('24'));
    // A same-workspace hydration/model publication must retain the live values.
    rerender(view({ ...workspace, files: [...files], models: [] }));
    expect(screen.getByRole('spinbutton', { name: 'Amount' })).toHaveValue(12);
    await waitFor(() => expect(screen.getByRole('region', { name: 'result output' })).toHaveTextContent('24'));
    const disposedBefore = dispose.mock.calls.length;
    rerender(view({ ...workspace, ...(boundary === 'id' ? { workspaceId: 'b' } : { workspaceEpoch: 2 }) }));
    await screen.findByRole('button', { name: 'Choose calculation' });
    expect(dispose.mock.calls.length).toBeGreaterThan(disposedBefore);
    expect(screen.queryByRole('spinbutton', { name: 'Amount' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'result output' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Choose calculation' }));
    expect(await screen.findByRole('spinbutton', { name: 'Amount' })).not.toHaveValue(12);
  }
);
