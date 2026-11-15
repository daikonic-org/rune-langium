// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { it, expect, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createProjectSnapshot } from '@rune-langium/project-config';
import * as references from '../../../src/services/project-references.js';
import { useProjectRuntime } from '../../../src/shell/providers/use-project-runtime.js';
import type { WorkspaceFile } from '../../../src/services/workspace.js';

it.each(['scripts/prepare.ts', 'scripts/driver.js'])(
  'recaptures unsaved %s edits without reloading references or changing the saved project',
  async (path) => {
    const snapshot = await createProjectSnapshot(
      'preparation',
      new Map([
        ['rune-config.yml', 'model: {name: Preparation}'],
        ['build-config.yml', 'schemaVersion: 1'],
        ['model/run.rosetta', 'namespace test'],
        ['scripts/prepare.ts', 'export default async () => ({})'],
        ['scripts/driver.js', 'export const driver = 1'],
        [
          'workflows/data.workflow.json',
          JSON.stringify({
            schemaVersion: 1,
            id: 'data',
            name: 'Data',
            inputs: {},
            outputs: {},
            preparation: {
              module: 'scripts/prepare.ts',
              driver: 'scripts/driver.js',
              outputs: ['model/run.rosetta']
            }
          })
        ]
      ]),
      () => []
    );
    const load = vi.spyOn(references, 'loadProjectReferences').mockResolvedValue({ documents: [], diagnostics: [] });
    try {
      const project = { status: 'ready' as const, workspaceId: snapshot.workspaceId, snapshot, diagnostics: [] };
      const files: WorkspaceFile[] = ['model/run.rosetta', 'scripts/prepare.ts', 'scripts/driver.js'].map((path) => ({
        path,
        name: path,
        content: snapshot.files.get(path)!,
        dirty: false
      }));
      const { result, rerender } = renderHook(({ files }) => useProjectRuntime(project, files), {
        initialProps: { files }
      });
      await waitFor(() => expect(result.current.status).toBe('captured'));
      const firstRevision = result.current.input?.receipt.revision;
      const edited = snapshot.files.get(path) + '\n// Unsaved edit';
      rerender({ files: files.map((file) => (file.path === path ? { ...file, content: edited, dirty: true } : file)) });
      await waitFor(() => expect(result.current.input?.snapshot.files.get(path)).toBe(edited));
      expect(result.current.status).toBe('captured');
      expect(result.current.input?.receipt.revision).not.toBe(firstRevision);
      expect(snapshot.files.get(path)).not.toBe(edited);
      expect(load).toHaveBeenCalledOnce();
    } finally {
      load.mockRestore();
    }
  }
);

it('retries unavailable reference bytes without editing config or replacing the saved lock', async () => {
  const snapshot = await createProjectSnapshot(
    'retry',
    new Map([
      ['rune-config.yml', 'model: {name: Retry}'],
      ['build-config.yml', 'schemaVersion: 1']
    ]),
    () => []
  );
  const load = vi
    .spyOn(references, 'loadProjectReferences')
    .mockResolvedValueOnce({
      documents: [],
      diagnostics: [
        { code: 'REFERENCE_UNAVAILABLE', path: 'references', severity: 'error', message: 'Offline cache miss' }
      ]
    })
    .mockResolvedValue({ documents: [], diagnostics: [] });
  try {
    const project = { status: 'ready' as const, workspaceId: 'retry', snapshot, diagnostics: [] };
    const files: [] = [];
    const { result } = renderHook(() => useProjectRuntime(project, files));
    await waitFor(() => expect(result.current.status).toBe('unavailable'));
    expect(result.current.retry).toBeTypeOf('function');
    act(() => result.current.retry!());
    await waitFor(() => expect(result.current.status).toBe('captured'));
    expect(result.current.input!.snapshot.revision).toBe(snapshot.revision);
    expect(load).toHaveBeenCalledTimes(2);
  } finally {
    load.mockRestore();
  }
});

it('refreshes accepted Nightly documents while the saved configuration and lock stay unchanged', async () => {
  const snapshot = await createProjectSnapshot(
    'refresh',
    new Map([
      ['rune-config.yml', 'model: {name: Refresh}'],
      [
        'build-config.yml',
        'schemaVersion: 1\nreferences:\n  cdm:\n    repository: https://github.com/finos/common-domain-model\n    release: nightly'
      ]
    ]),
    () => []
  );
  const previous = { uri: 'cdm/model.rosetta', content: 'namespace moving\ntype Payment:\n amount number (1..1)' };
  const updated = { ...previous, content: previous.content + '\n updated string (0..1)' };
  const load = vi
    .spyOn(references, 'loadProjectReferences')
    .mockResolvedValueOnce({ documents: [previous], diagnostics: [] })
    .mockResolvedValue({ documents: [updated], diagnostics: [] });
  try {
    const project = { status: 'ready' as const, workspaceId: 'refresh', snapshot, diagnostics: [] };
    const files: [] = [];
    const { result } = renderHook(() => useProjectRuntime(project, files));
    await waitFor(() => expect(result.current.input?.referenceDocuments).toEqual([previous]));
    expect(result.current.retry).toBeUndefined();
    act(() => result.current.refresh!());
    await waitFor(() => expect(result.current.input?.referenceDocuments).toEqual([updated]));
    expect(load).toHaveBeenCalledTimes(2);
    expect(result.current.input!.snapshot.revision).toBe(snapshot.revision);
    expect(result.current.input!.snapshot.lock).toBeUndefined();
  } finally {
    load.mockRestore();
  }
});
