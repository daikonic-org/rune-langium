// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkspaceProvider } from '../../src/shell/providers/WorkspaceProvider.js';
import { GitSyncPerspective } from '../../src/shell/perspectives/screens/GitSyncPerspective.js';
import type { WorkspaceActions } from '../../src/shell/perspectives/workspace-actions-context.js';
import { createProjectController } from '../../src/workspace/project-controller.js';
import { createProjectFileAdapter } from '../../src/workspace/project-file-adapter.js';
import { createExampleRepository } from '../../src/workspace/example-repository.js';
import { createPresentationRepository } from '../../src/workspace/form-presentation-repository.js';
import { useInstanceStore } from '../../src/store/instance-store.js';
import { useFormPresentationStore } from '../../src/store/form-presentation-store.js';
import { createOpfsRoot } from '../setup/opfs-mock.js';
import { declarationKey } from '@rune-langium/core/project-contract';
import { readExamples, readPresentations } from '@rune-langium/project-config';

const { syncNow } = vi.hoisted(() => ({ syncNow: vi.fn() }));
vi.mock('../../src/services/git-sync.js', () => ({
  subscribeToEngine: (_id: string, callback: (status: object) => void) => {
    callback({ phase: 'idle', ahead: 0, behind: 0, lastSyncedSha: null, dirty: true });
    return () => {};
  },
  getSyncEngine: () => ({ syncNow }),
  resolveConflict: vi.fn()
}));
const id = 'portable-publication';
const type = { model: 'local', namespace: 'example', kind: 'Data', name: 'Money' };
const key = declarationKey(type);
afterEach(async () => {
  useInstanceStore.getState().setExampleRepository(undefined);
  await useFormPresentationStore.getState().setRepository(id, undefined);
  vi.clearAllMocks();
});

async function setup() {
  const adapter = createProjectFileAdapter({
    workspaceId: id,
    root: createOpfsRoot() as unknown as FileSystemDirectoryHandle,
    privateRoot: createOpfsRoot() as unknown as FileSystemDirectoryHandle,
    isWritable: () => true
  });
  await adapter.write('rune-config.yml', 'model: { name: Example }\n', null);
  await adapter.write('build-config.yml', 'schemaVersion: 1\nsources: ["**/*.rosetta"]\ntargets: {}\n', null);
  await adapter.write('money.rosetta', 'namespace example\ntype Money:\n amount number (1..1)\n', null);
  const controller = createProjectController({ workspaceId: id, adapter, validateTarget: () => [] });
  await controller.load();
  const source = {
    files: [{ path: 'money.rosetta', name: 'money.rosetta', content: '', dirty: false }],
    parsedModels: [
      { filePath: 'money.rosetta', model: { name: 'example', elements: [{ $type: 'Data', name: 'Money' }] } }
    ],
    deferredExports: []
  } as never;
  const sourceSave = vi.fn(async () => {});
  const actions = { files: [], flushWorkspaceSave: sourceSave } as unknown as WorkspaceActions;
  render(
    <WorkspaceProvider
      state={{
        workspaceId: id,
        workspaceKind: 'git-backed',
        workspaceName: id,
        fileCount: 0,
        files: [],
        models: [],
        parsedModels: [],
        deferredExports: []
      }}
      actions={actions}
    >
      <GitSyncPerspective workspaceId={id} workspaceKind="git-backed" />
    </WorkspaceProvider>
  );
  useInstanceStore
    .getState()
    .setExampleRepository(createExampleRepository({ workspaceId: id, controller, resolveType: () => type }));
  await useFormPresentationStore
    .getState()
    .setRepository(id, createPresentationRepository({ controller, source: () => source }));
  const reopened = () => createProjectController({ workspaceId: id, adapter, validateTarget: () => [] }).load();
  syncNow.mockImplementation(async () => reopened());
  return { adapter, controller, reopened, sourceSave };
}

it.each(['example', 'presentation'] as const)(
  'waits for a complete %s transaction and late edits in either save stream',
  async (blocked) => {
    const { adapter, reopened } = await setup();
    const payloadWritten = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const write = adapter.write;
    adapter.write = async (path, text, revision) => {
      const result = await write(path, text, revision);
      if (
        blocked === 'example'
          ? path.startsWith('examples/') && !path.endsWith('.example.json')
          : path.startsWith('layouts/')
      ) {
        payloadWritten.resolve();
        await resume.promise;
      }
      return result;
    };
    let record!: string;
    act(() => {
      if (blocked === 'example')
        record = useInstanceStore
          .getState()
          .createInstance('example.Money', 'Input', { data: { amount: 1 }, typeIdentity: type });
      else
        useFormPresentationStore
          .getState()
          .update(id, (current) => ({ ...current, layouts: { [key]: { columns: 1, order: ['amount'], spans: {} } } }));
    });
    await payloadWritten.promise;
    fireEvent.click(screen.getByRole('button', { name: 'Commit and push' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(syncNow).not.toHaveBeenCalled();
    act(() => {
      if (record) useInstanceStore.getState().updateInstanceData(record, { amount: 2 });
      else
        record = useInstanceStore
          .getState()
          .createInstance('example.Money', 'Input', { data: { amount: 2 }, typeIdentity: type });
      useFormPresentationStore
        .getState()
        .update(id, (current) => ({ ...current, layouts: { [key]: { columns: 2, order: ['amount'], spans: {} } } }));
    });
    resume.resolve();
    await waitFor(() => expect(syncNow).toHaveBeenCalledOnce());
    const saved = await reopened();
    expect(readExamples(saved).documents[0]?.payload).toEqual({ amount: 2 });
    expect(readPresentations(saved).presentations[0]?.columns).toBe(2);
  }
);

it.each(['example', 'presentation'] as const)(
  'blocks publication after a settled %s save failure and permits explicit retry',
  async (kind) => {
    const { adapter } = await setup();
    const write = adapter.write;
    adapter.write = async () => {
      throw new Error('disk unavailable');
    };
    let record!: string;
    act(() => {
      if (kind === 'example')
        record = useInstanceStore
          .getState()
          .createInstance('example.Money', 'Input', { data: { amount: 5 }, typeIdentity: type });
      else
        useFormPresentationStore
          .getState()
          .update(id, (current) => ({ ...current, layouts: { [key]: { columns: 2, order: ['amount'], spans: {} } } }));
    });
    await waitFor(() => {
      if (kind === 'example') expect(useInstanceStore.getState().saveStates[record]?.state).toBe('failed');
      else expect(useFormPresentationStore.getState().workspaces[id]?.error).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Commit and push' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeVisible());
    expect(syncNow).not.toHaveBeenCalled();
    adapter.write = write;
    await act(async () => {
      if (kind === 'example') await useInstanceStore.getState().retrySave(record);
      else await useFormPresentationStore.getState().retry(id);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Commit and push' }));
    await waitFor(() => expect(syncNow).toHaveBeenCalledOnce());
  }
);

it('drains a new portable edit made while source flushing is still pending', async () => {
  const { adapter, sourceSave } = await setup();
  const source = Promise.withResolvers<void>();
  sourceSave.mockReturnValueOnce(source.promise);
  fireEvent.click(screen.getByRole('button', { name: 'Commit and push' }));
  await waitFor(() => expect(sourceSave).toHaveBeenCalledOnce());
  const payloadWritten = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  const write = adapter.write;
  adapter.write = async (path, text, revision) => {
    const result = await write(path, text, revision);
    if (path.startsWith('examples/') && !path.endsWith('.example.json')) {
      payloadWritten.resolve();
      await resume.promise;
    }
    return result;
  };
  act(() => {
    useInstanceStore
      .getState()
      .createInstance('example.Money', 'Late input', { data: { amount: 9 }, typeIdentity: type });
  });
  await payloadWritten.promise;
  await act(async () => {
    source.resolve();
    await Promise.resolve();
  });
  expect(syncNow).not.toHaveBeenCalled();
  resume.resolve();
  await waitFor(() => expect(syncNow).toHaveBeenCalledOnce());
  const saved = await syncNow.mock.results[0]!.value;
  expect(readExamples(saved).documents[0]?.payload).toEqual({ amount: 9 });
});
