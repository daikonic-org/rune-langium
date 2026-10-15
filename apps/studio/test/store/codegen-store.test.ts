// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { beforeEach, describe, expect, it } from 'vitest';
import { useCodegenStore } from '../../src/store/codegen-store.js';

describe('useCodegenStore', () => {
  beforeEach(() => {
    useCodegenStore.getState().resetCodegenState();
  });

  it('sets the selected code preview target and marks the snapshot waiting', () => {
    useCodegenStore.getState().setCodePreviewTarget('typescript');

    expect(useCodegenStore.getState().codePreviewTarget).toBe('typescript');
    expect(useCodegenStore.getState().currentRequestId).toBe('codegen:typescript:0');
    expect(useCodegenStore.getState().snapshot).toMatchObject({
      status: 'waiting',
      target: 'typescript'
    });
  });

  it('issues a fresh request id when code preview generation begins', () => {
    const requestId = useCodegenStore.getState().beginCodePreviewRequest('zod');

    expect(requestId).toMatch(/^codegen:zod:/);
    expect(useCodegenStore.getState().currentRequestId).toBe(requestId);
    expect(useCodegenStore.getState().snapshot).toMatchObject({
      status: 'waiting',
      target: 'zod'
    });
  });

  it('stores the last generated preview result and preserves it when stale', () => {
    useCodegenStore.getState().receiveCodePreviewResult({
      target: 'zod',
      files: [
        {
          relativePath: 'trade.zod.ts',
          content: 'export const TradeSchema = z.object({});',
          sourceMap: []
        }
      ]
    });
    useCodegenStore.getState().markCodePreviewStale({
      target: 'zod',
      message: 'Fix model errors to refresh the code preview.'
    });

    expect(useCodegenStore.getState().snapshot).toMatchObject({
      status: 'stale',
      target: 'zod',
      activeRelativePath: 'trade.zod.ts',
      files: [{ relativePath: 'trade.zod.ts', content: 'export const TradeSchema = z.object({});' }]
    });
  });

  it('marks the preview unavailable when stale is received before any generated output', () => {
    useCodegenStore
      .getState()
      .markCodePreviewStale({ target: 'zod', message: 'No files are loaded for code preview.' });

    expect(useCodegenStore.getState().snapshot).toMatchObject({
      status: 'unavailable',
      target: 'zod',
      message: 'No files are loaded for code preview.'
    });
  });

  it('retains the selected output across repeated refreshes that return stale', () => {
    const files = ['alpha', 'beta'].map((name) => ({ relativePath: `${name}.ts`, content: name, sourceMap: [] }));
    useCodegenStore.getState().receiveCodePreviewResult({ target: 'typescript', files });
    useCodegenStore.getState().setActiveCodePreviewFile('beta.ts');
    useCodegenStore.getState().beginCodePreviewRequest('typescript');
    useCodegenStore.getState().beginCodePreviewRequest('typescript');
    useCodegenStore.getState().markCodePreviewStale({ target: 'typescript', message: 'Fix source errors.' });
    expect(useCodegenStore.getState().snapshot).toMatchObject({
      status: 'stale',
      target: 'typescript',
      files,
      activeRelativePath: 'beta.ts'
    });
    useCodegenStore.getState().beginCodePreviewRequest('typescript');
    useCodegenStore.getState().receiveCodePreviewResult({ target: 'typescript', files });
    expect(useCodegenStore.getState().snapshot).toMatchObject({ status: 'ready', activeRelativePath: 'beta.ts' });
  });

  it.each(['target switch', 'workspace reset'] as const)('clears recovery contents after %s', (transition) => {
    useCodegenStore.getState().receiveCodePreviewResult({
      target: 'typescript',
      files: [{ relativePath: 'alpha.ts', content: 'alpha', sourceMap: [] }]
    });
    if (transition === 'workspace reset') useCodegenStore.getState().resetCodegenState();
    const target = transition === 'workspace reset' ? 'typescript' : 'zod';
    useCodegenStore.getState().beginCodePreviewRequest(target);
    useCodegenStore.getState().markCodePreviewStale({ target, message: 'Fix source errors.' });
    expect(useCodegenStore.getState().snapshot).toEqual({
      status: 'unavailable',
      target,
      message: 'Fix source errors.'
    });
  });

  it('preserves the selected generated file when a refreshed result still contains it', () => {
    useCodegenStore.getState().receiveCodePreviewResult({
      target: 'zod',
      files: [
        { relativePath: 'alpha.zod.ts', content: 'alpha', sourceMap: [] },
        { relativePath: 'beta.zod.ts', content: 'beta', sourceMap: [] }
      ]
    });
    useCodegenStore.getState().setActiveCodePreviewFile('beta.zod.ts');
    useCodegenStore.getState().receiveCodePreviewResult({
      target: 'zod',
      files: [
        { relativePath: 'alpha.zod.ts', content: 'alpha2', sourceMap: [] },
        { relativePath: 'beta.zod.ts', content: 'beta2', sourceMap: [] }
      ]
    });

    expect(useCodegenStore.getState().snapshot).toMatchObject({
      status: 'ready',
      activeRelativePath: 'beta.zod.ts'
    });
  });

  it('clears stale generated files when the preview becomes unavailable', () => {
    useCodegenStore.getState().receiveCodePreviewResult({
      target: 'zod',
      files: [{ relativePath: 'alpha.zod.ts', content: 'alpha', sourceMap: [] }]
    });

    useCodegenStore.getState().markCodePreviewUnavailable({ target: 'zod', message: 'Code generation failed.' });

    expect(useCodegenStore.getState().snapshot).toEqual({
      status: 'unavailable',
      target: 'zod',
      message: 'Code generation failed.'
    });
  });

  // 018 Phase 0 Task 0.6 — `activeTarget` drives the table-vs-viewer
  // toggle in `CodePreviewPanel` (Task 0.8). `undefined` = show table;
  // a target = render the viewer for that target. Independent of
  // `codePreviewTarget`, which tracks what the worker most recently
  // generated.
  describe('activeTarget slice', () => {
    it('starts undefined so the targets table is shown by default', () => {
      expect(useCodegenStore.getState().activeTarget).toBeUndefined();
    });

    it('setActiveTarget switches the viewer to a specific target', () => {
      useCodegenStore.getState().setActiveTarget('typescript');
      expect(useCodegenStore.getState().activeTarget).toBe('typescript');
    });

    it('setActiveTarget(undefined) returns to the targets table', () => {
      useCodegenStore.getState().setActiveTarget('zod');
      useCodegenStore.getState().setActiveTarget(undefined);
      expect(useCodegenStore.getState().activeTarget).toBeUndefined();
    });

    it('does not touch codePreviewTarget or the snapshot', () => {
      useCodegenStore.getState().setCodePreviewTarget('typescript');
      const before = useCodegenStore.getState();
      useCodegenStore.getState().setActiveTarget('sql');
      const after = useCodegenStore.getState();
      expect(after.codePreviewTarget).toBe(before.codePreviewTarget);
      expect(after.snapshot).toBe(before.snapshot);
      expect(after.currentRequestId).toBe(before.currentRequestId);
    });

    it('resetCodegenState clears activeTarget back to undefined', () => {
      useCodegenStore.getState().setActiveTarget('graphql');
      useCodegenStore.getState().resetCodegenState();
      expect(useCodegenStore.getState().activeTarget).toBeUndefined();
    });
  });
});
