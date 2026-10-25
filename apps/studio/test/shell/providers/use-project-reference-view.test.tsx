// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { afterEach, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useProjectReferenceView } from '../../../src/shell/providers/use-project-reference-view.js';
import { prepareProjectReferenceView } from '../../../src/services/project-reference-view.js';
import type { WorkspaceState } from '../../../src/shell/providers/workspace-context.js';
import type { ProjectRuntimeState } from '../../../src/shell/providers/project-context.js';
import type { ProjectRuntimeInput } from '../../../src/services/project-runtime-input.js';
import { createProjectFileAdapter } from '../../../src/workspace/project-file-adapter.js';
import {
  loadWorkspaceFiles,
  saveWorkspaceFiles,
  setWorkspaceFilesDeps
} from '../../../src/workspace/workspace-files.js';
import { createOpfsRoot, writeBytes } from '../../setup/opfs-mock.js';

vi.mock('../../../src/services/project-reference-view.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/services/project-reference-view.js')>()),
  prepareProjectReferenceView: vi.fn()
}));
vi.mock('../../../src/services/workspace.js', () => ({ installProjectParserDocuments: vi.fn() }));

afterEach(() => {
  vi.mocked(prepareProjectReferenceView).mockReset();
  setWorkspaceFilesDeps({ getFolderProjectAdapter: undefined });
});

const file = (path: string, content: string) => ({ path, name: path, content, dirty: false });
const stateFor = (files: WorkspaceState['files'], workspaceId = 'editing'): WorkspaceState => ({
  workspaceId,
  files,
  fileCount: files.length,
  models: [],
  parsedModels: [],
  deferredExports: [],
  parseErrors: new Map()
});
const runtime: ProjectRuntimeState = {
  managed: true,
  status: 'captured',
  input: {} as ProjectRuntimeInput,
  diagnostics: []
};
const reference = { ...file('[cdm]/model.rosetta', 'namespace pinned'), readOnly: true, refOnly: true };

it('reports an initial failure without a previous view or workspace identity', async () => {
  const state = { ...stateFor([]), workspaceId: undefined };
  vi.mocked(prepareProjectReferenceView).mockRejectedValue(new Error('Reference view unavailable.'));
  const { result } = renderHook(() => useProjectReferenceView(runtime, state));
  await waitFor(() => expect(result.current.referenceView?.status).toBe('unavailable'));
  expect(result.current.referenceView?.diagnostics[0]?.message).toBe('Reference view unavailable.');
  expect(result.current.state.files).toBe(state.files);
});

it('autosaves edits to A and B made before a reference-view refresh without reverting A', async () => {
  const root = createOpfsRoot(),
    privateRoot = createOpfsRoot();
  const original = [file('a.rosetta', 'namespace a'), file('b.rosetta', 'namespace b')];
  for (const entry of original) await writeBytes(root, new TextEncoder().encode(entry.content), entry.path);
  const adapter = createProjectFileAdapter({
    workspaceId: 'editing',
    root: root as unknown as FileSystemDirectoryHandle,
    privateRoot: privateRoot as unknown as FileSystemDirectoryHandle,
    isWritable: () => true
  });
  setWorkspaceFilesDeps({ getFolderProjectAdapter: async () => adapter });
  const state = stateFor(await loadWorkspaceFiles('editing'));
  const view = { ...state, files: [...state.files, reference] };
  vi.mocked(prepareProjectReferenceView)
    .mockResolvedValueOnce(view)
    .mockImplementation(() => new Promise(() => {}));
  const { result, rerender } = renderHook(({ state }) => useProjectReferenceView(runtime, state), {
    initialProps: { state }
  });
  await waitFor(() => expect(result.current.referenceView?.status).toBe('ready'));
  const edited = {
    ...state,
    files: state.files.map((entry) =>
      entry.path === 'a.rosetta' ? { ...entry, content: 'namespace a\n// first edit', dirty: true } : entry
    )
  };
  rerender({ state: edited });
  // This is the same read/modify/write contract used by Explore's latest-files ref.
  const secondEdit = result.current.state.files.map((entry) =>
    entry.path === 'b.rosetta' ? { ...entry, content: 'namespace b\n// second edit', dirty: true } : entry
  );
  await saveWorkspaceFiles('editing', secondEdit);
  expect((await adapter.read('a.rosetta'))?.text).toContain('// first edit');
  expect((await adapter.read('b.rosetta'))?.text).toContain('// second edit');
  expect(result.current.referenceView?.status).toBe('loading');
  expect(result.current.state.files).toContain(reference);
  expect(result.current.state.models).toBe(view.models);
});

it('keeps additions, deletions and current workspace metadata while a retained view is waiting for the parser', async () => {
  const state = stateFor([file('a.rosetta', 'namespace a'), file('b.rosetta', 'namespace b')]);
  const view = { ...state, files: [...state.files, reference] };
  vi.mocked(prepareProjectReferenceView)
    .mockResolvedValueOnce(view)
    .mockRejectedValue(new Error('Waiting for the parser snapshot of the current source: a.rosetta'));
  const { result, rerender } = renderHook(({ state }) => useProjectReferenceView(runtime, state), {
    initialProps: { state }
  });
  await waitFor(() => expect(result.current.referenceView?.status).toBe('ready'));
  const current = { ...state, workspaceName: 'Renamed', files: [state.files[0]!, file('c.rosetta', 'namespace c')] };
  rerender({ state: current });
  expect(result.current.state.files.map((entry) => entry.path)).toEqual(['a.rosetta', 'c.rosetta', reference.path]);
  expect(result.current.state.workspaceName).toBe('Renamed');
  await act(async () => {});
  expect(result.current.state.files).toContain(reference);
  expect(result.current.referenceView?.status).toBe('loading');
  rerender({ state: stateFor([file('next.rosetta', 'namespace next')], 'next') });
  expect(result.current.state.files.map((entry) => entry.path)).toEqual(['next.rosetta']);
});
