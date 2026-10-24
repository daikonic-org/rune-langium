// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { it, expect, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createProjectSnapshot } from '@rune-langium/project-config';
import * as references from '../../../src/services/project-references.js';
import { useProjectRuntime } from '../../../src/shell/providers/use-project-runtime.js';
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
