// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { InspectorDeclarationActions } from '../../src/components/InspectorDeclarationActions.js';
const mocks = vi.hoisted(() => ({ prepare: vi.fn(), modify: vi.fn(), validate: vi.fn() }));
vi.mock('../../src/services/local-declaration.js', () => ({
  canExtendDeclaration: (kind: string) => ['Data', 'RosettaFunction'].includes(kind),
  localDeclarationError: mocks.validate,
  prepareLocalDeclaration: mocks.prepare,
  modifyProjectDeclaration: mocks.modify
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const file = { name: 'External.rosetta', path: 'local/demo/External.rosetta', content: 'source', dirty: true };
function props() {
  return {
    nodeId: 'demo.External#RosettaFunction',
    ready: true,
    refOnly: true,
    getSnapshot: () => ({ files: [], models: [] }),
    onCreate: vi.fn(),
    flush: vi.fn(async () => {})
  };
}
it('offers Extend for local declarations, Modify only for references, and waits for readiness', () => {
  const p = props();
  const { rerender } = render(<InspectorDeclarationActions {...p} ready={false} />);
  expect(screen.getByRole('button', { name: 'Extend declaration' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Modify local copy' })).toBeDisabled();
  rerender(<InspectorDeclarationActions {...p} refOnly={false} />);
  expect(screen.queryByRole('button', { name: 'Modify local copy' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Extend declaration' })).toBeEnabled();
});
it('creates a local copy after flushing pending edits and reports recoverable source errors', async () => {
  const p = props();
  mocks.prepare.mockRejectedValueOnce(new Error('Source unavailable')).mockResolvedValueOnce([file]);
  render(<InspectorDeclarationActions {...p} />);
  fireEvent.click(screen.getByRole('button', { name: 'Modify local copy' }));
  expect(screen.getByLabelText('Name')).toHaveAttribute('readonly');
  fireEvent.click(screen.getByRole('button', { name: 'Create local copy' }));
  await screen.findByText('Source unavailable');
  expect(p.onCreate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Create local copy' }));
  await waitFor(() => expect(p.onCreate).toHaveBeenCalledWith([file]));
  expect(p.flush).toHaveBeenCalledTimes(2);
});
it.each(['cancel', 'unmount'])('discards late source responses after %s', async (action) => {
  const p = props();
  let release!: (file: unknown) => void;
  mocks.prepare.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  const view = render(<InspectorDeclarationActions {...p} />);
  fireEvent.click(screen.getByRole('button', { name: 'Modify local copy' }));
  fireEvent.click(screen.getByRole('button', { name: 'Create local copy' }));
  await waitFor(() => expect(mocks.prepare).toHaveBeenCalledOnce());
  if (action === 'cancel') fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
  else view.unmount();
  release([file]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(p.onCreate).not.toHaveBeenCalled();
});
it('rechecks collisions against current workspace data before appending a loaded copy', async () => {
  const p = props();
  mocks.prepare.mockResolvedValue([file]);
  mocks.validate.mockReturnValue('Already exists');
  render(<InspectorDeclarationActions {...p} />);
  fireEvent.click(screen.getByRole('button', { name: 'Modify local copy' }));
  fireEvent.click(screen.getByRole('button', { name: 'Create local copy' }));
  await screen.findByText('Already exists');
  expect(p.onCreate).not.toHaveBeenCalled();
});

it('saves a managed copy and map only after the saved revision has an applied worker receipt', async () => {
  const { ProjectContext } = await import('../../src/shell/providers/project-context.js');
  const { ProjectPreviewReadinessContext } = await import('../../src/shell/providers/preview-session-context.js');
  const p = props();
  const snapshot = { revision: 'saved' } as import('@rune-langium/project-config').ProjectSnapshot;
  const saved = { ...snapshot, revision: 'modified' };
  const controller = {
    load: vi.fn().mockResolvedValue(snapshot)
  } as unknown as import('../../src/workspace/project-controller.js').ProjectController;
  const receipt = { revision: 'saved', lockDigest: 'lock', overridesDigest: 'map' };
  const ensureSaved = vi.fn().mockResolvedValue({ receipt, referenceDocuments: [] });
  const onSaved = vi.fn();
  mocks.modify.mockResolvedValue(saved);
  render(
    <ProjectContext.Provider
      value={{
        status: 'ready',
        controller,
        diagnostics: [],
        runtime: { managed: true, status: 'captured', diagnostics: [] }
      }}
    >
      <ProjectPreviewReadinessContext.Provider value={{ ensureSaved }}>
        <InspectorDeclarationActions {...p} onSaved={onSaved} />
      </ProjectPreviewReadinessContext.Provider>
    </ProjectContext.Provider>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Modify local copy' }));
  fireEvent.click(screen.getByRole('button', { name: 'Create local copy' }));
  await waitFor(() =>
    expect(onSaved).toHaveBeenCalledWith(
      saved,
      expect.objectContaining({ mode: 'modify', projectReceipt: receipt }),
      snapshot
    )
  );
  expect(ensureSaved).toHaveBeenCalledWith('saved', expect.any(AbortSignal));
  expect(mocks.modify).toHaveBeenCalledWith(expect.objectContaining({ projectReceipt: receipt }), controller);
  expect(mocks.prepare).not.toHaveBeenCalled();
  expect(p.onCreate).not.toHaveBeenCalled();
});
