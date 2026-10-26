// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { StrictMode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { ReferenceExampleImport } from '../../src/components/ReferenceExampleImport.js';
import { PreviewSessionContext } from '../../src/shell/providers/preview-session-context.js';
import { ProjectContext, type ProjectState } from '../../src/shell/providers/project-context.js';
import { WorkspaceStateContext, type WorkspaceState } from '../../src/shell/providers/workspace-context.js';
import { captureProjectRuntimeInput } from '../../src/services/project-runtime-input.js';
import { useInstanceStore } from '../../src/store/instance-store.js';
import { usePrototypeViewStore } from '../../src/store/prototype-view-store.js';
import { createExampleRepository } from '../../src/workspace/example-repository.js';
import { createProjectController } from '../../src/workspace/project-controller.js';
import { createProjectFileAdapter } from '../../src/workspace/project-file-adapter.js';
import { createOpfsRoot } from '../setup/opfs-mock.js';

const origin = {
  model: 'cdm',
  repository: 'https://github.com/finos/common-domain-model',
  release: 'nightly',
  commit: 'a'.repeat(40)
};
const payload = JSON.stringify({
  '@model': 'cdm',
  '@type': 'example.Payment',
  '@version': '0.0.0.master-SNAPSHOT',
  amount: 10
});
const path = 'examples/payment.json';
afterEach(async () => {
  useInstanceStore.getState().setExampleRepository(undefined);
  vi.unstubAllGlobals();
});
async function setup(options: { bad?: boolean; version?: string } = {}) {
  const entries = new Map([
    [path, options.version ? payload.replace('0.0.0.master-SNAPSHOT', options.version) : payload],
    ...(options.bad ? ([['examples/bad.json', '{bad']] as [string, string][]) : [])
  ]);
  const blobs = [...entries].map(([path, text]) => {
    const bytes = new TextEncoder().encode(text);
    return {
      path,
      sha: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),
      mode: '100644',
      type: 'blob',
      size: bytes.length
    };
  });
  const fetcher = vi.fn(async (url: string) => {
    if (url.includes('/commits/'))
      return Response.json({ sha: origin.commit, commit: { tree: { sha: 'b'.repeat(40) } } });
    if (url.includes('/git/trees/')) return Response.json({ truncated: false, tree: blobs });
    const blob = blobs.find((entry) => url.endsWith(entry.sha));
    return blob ? new Response(entries.get(blob.path)) : new Response('', { status: 404 });
  });
  vi.stubGlobal('fetch', fetcher);
  const adapter = createProjectFileAdapter({
    workspaceId: 'example-import',
    root: createOpfsRoot() as unknown as FileSystemDirectoryHandle,
    privateRoot: createOpfsRoot() as unknown as FileSystemDirectoryHandle,
    isWritable: () => true
  });
  const controller = createProjectController({ workspaceId: 'example-import', adapter, validateTarget: () => [] });
  const snapshot = await controller.load();
  const input = await captureProjectRuntimeInput(
    snapshot,
    [],
    [{ uri: 'cdm/model.rosetta', content: '', source: origin }]
  );
  const project: ProjectState = {
    workspaceId: snapshot.workspaceId,
    snapshot,
    controller,
    status: 'ready',
    diagnostics: [],
    runtime: { managed: true, status: 'captured', input, diagnostics: [] }
  };
  const workspace: WorkspaceState = {
    workspaceId: snapshot.workspaceId,
    fileCount: 1,
    models: [],
    parsedModels: [],
    deferredExports: [],
    parseErrors: new Map(),
    files: [
      {
        path: 'cdm/model.rosetta',
        name: 'model.rosetta',
        content: '',
        namespace: 'example',
        bundleId: 'cdm',
        readOnly: true,
        refOnly: true,
        dirty: false,
        exports: [{ name: 'Payment', type: 'Data' }]
      }
    ]
  };
  const repository = createExampleRepository({
    workspaceId: snapshot.workspaceId,
    controller,
    resolveType: () => ({ model: 'cdm', namespace: 'example', kind: 'Data', name: 'Payment' })
  });
  useInstanceStore.getState().setExampleRepository(repository);
  await useInstanceStore.getState().loadInstancesFromOpfs();
  usePrototypeViewStore.setState({
    state: { selectedId: 'existing-input', query: '', typeFqn: null, graphVisible: false }
  });
  const factory = () => {
    let disposed = false;
    return {
      decode: vi.fn(async (_type, data) => {
        if (disposed) throw new Error('disposed client');
        return data;
      }),
      schema: vi.fn(),
      validate: vi.fn(),
      execute: vi.fn(),
      project: vi.fn(),
      dispose: () => {
        disposed = true;
      }
    };
  };
  const view = (value = project) => (
    <StrictMode>
      <PreviewSessionContext value={factory}>
        <ProjectContext value={value}>
          <WorkspaceStateContext value={workspace}>
            <ReferenceExampleImport />
          </WorkspaceStateContext>
        </ProjectContext>
      </PreviewSessionContext>
    </StrictMode>
  );
  const mounted = render(view());
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Reference examples…' }));
  await screen.findByRole('checkbox', { name: `Select ${path}` });
  return { user, controller, fetcher, mounted, view, project };
}
it('saves single/bulk imports with provenance, reports partial failures and preserves workflow bindings', async () => {
  const { user, controller } = await setup({ bad: true });
  await user.click(screen.getByRole('checkbox', { name: `Select ${path}` }));
  await user.click(screen.getByRole('checkbox', { name: 'Select examples/bad.json' }));
  await user.click(screen.getByRole('button', { name: 'Import 2 into library' }));
  await screen.findByText(`${path}: imported.`);
  expect(screen.getByText(/examples\/bad.json:/)).toBeVisible();
  expect(Object.values(useInstanceStore.getState().instances)).toHaveLength(1);
  const record = Object.values(useInstanceStore.getState().instances)[0]!;
  expect(record.provenance?.reference).toMatchObject({ ...origin, path, format: 'RUNE_JSON' });
  expect(usePrototypeViewStore.getState().state.selectedId).toBe('existing-input');
  expect([...controller.current()!.files.keys()].filter((file) => file.startsWith('examples/'))).toHaveLength(2);
  await user.click(screen.getByRole('button', { name: 'Import 2 into library' }));
  await screen.findByText(/already in the library/);
  expect(Object.values(useInstanceStore.getState().instances)).toHaveLength(1);
});
it('requires an explicit acknowledgement for payload version mismatches', async () => {
  const { user } = await setup({ version: '7.0.0' });
  await user.click(screen.getByRole('button', { name: path, exact: true }));
  await screen.findByText(/Payload version 7.0.0 differs/);
  await user.click(screen.getByRole('checkbox', { name: `Select ${path}` }));
  await user.click(screen.getByRole('button', { name: 'Import 1 into library' }));
  await screen.findByText(/Review and acknowledge/);
  expect(Object.values(useInstanceStore.getState().instances)).toHaveLength(0);
  await user.click(screen.getByRole('checkbox', { name: /Import selected payloads with version warnings/ }));
  await user.click(screen.getByRole('button', { name: 'Import 1 into library' }));
  await screen.findByText(`${path}: imported.`);
});
it('retains selections during capture refresh but invalidates them for a changed source', async () => {
  const { user, mounted, view, project } = await setup();
  await user.click(screen.getByRole('checkbox', { name: `Select ${path}` }));
  expect(screen.getByRole('button', { name: 'Import 1 into library' })).toBeEnabled();
  const changed = { ...project, runtime: { ...project.runtime!, status: 'loading' as const, input: undefined } };
  await act(async () => mounted.rerender(view(changed)));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Import 1 into library' })).toBeDisabled());
  const updated = {
    ...project,
    runtime: {
      ...project.runtime!,
      input: {
        ...project.runtime!.input!,
        referenceDocuments: [{ uri: 'cdm/model.rosetta', content: '', source: { ...origin, commit: 'c'.repeat(40) } }]
      }
    }
  };
  await act(async () => mounted.rerender(view(updated)));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Import 1 into library' })).toBeNull());
  expect(Object.values(useInstanceStore.getState().instances)).toHaveLength(0);
});
it('renders safely before the project and reference capture are available', () => {
  render(<ReferenceExampleImport />);
  expect(screen.getByRole('button', { name: 'Reference examples…' })).toBeVisible();
});
