// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, describe, expect, it } from 'vitest';
import { buildStudioDebugReport } from '../../src/services/debug-report.js';
import { useOutputStore } from '../../src/store/output-store.js';
import { useDiagnosticsStore } from '../../src/store/diagnostics-store.js';
import type { WorkspaceState } from '../../src/shell/providers/workspace-context.js';

const workspace: WorkspaceState = {
  workspaceId: 'workspace-1',
  workspaceName: 'Scratch',
  fileCount: 1,
  files: [
    {
      name: 'sample.rosetta',
      path: 'sample.rosetta',
      content: 'secret-source',
      dirty: false,
      readOnly: true,
      bundleId: 'rune',
      bundleVersion: 'immutable-cohort'
    }
  ],
  models: [],
  parsedModels: [],
  deferredExports: [],
  parseErrors: new Map([['sample.rosetta', ['Parse failure']]])
};

afterEach(() => {
  useOutputStore.getState().clearLines();
  useDiagnosticsStore.getState().clearAll();
});

describe('local debug report', () => {
  it('exports pinned structural state and diagnostic correlation without source or credentials by default', () => {
    useOutputStore.getState().addLine('Validation failed', 'error', { op: 'preview', opId: 8, signature: 'sig' });
    useDiagnosticsStore.getState().setFileDiagnostics('file:///sample.rosetta', [
      {
        message: 'Unknown type',
        severity: 1,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } }
      }
    ]);
    const report = buildStudioDebugReport(workspace);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('secret-source');
    expect(serialized).not.toMatch(/token|cookie|localStorage|sessionStorage|serializedModel/);
    expect(report.workspace?.files[0]).toMatchObject({
      bundleId: 'rune',
      bundleVersion: 'immutable-cohort',
      sourceIncluded: false
    });
    expect(report.logs.output.at(-1)).toMatchObject({ text: 'Validation failed', opId: 8, signature: 'sig' });
    expect(report.diagnostics.lsp[0]?.diagnostics[0]?.message).toBe('Unknown type');
    expect(report.diagnostics.parse).toEqual([{ path: 'sample.rosetta', messages: ['Parse failure'] }]);
    expect(report.environment.studioVersion).toBeTruthy();
    expect(useOutputStore.getState().lines).toHaveLength(1);
  });

  it('includes available source only after explicit opt-in and never hydrates lazy files', () => {
    expect(buildStudioDebugReport(workspace, { includeSource: true }).workspace?.files[0]?.content).toBe(
      'secret-source'
    );
    const lazy = { ...workspace, files: [{ ...workspace.files[0]!, content: '' }] };
    const file = buildStudioDebugReport(lazy, { includeSource: true }).workspace?.files[0];
    expect(file).toMatchObject({ content: '', sourceIncluded: true });
    expect(lazy.files[0]?.content).toBe('');
    expect(buildStudioDebugReport(null).workspace).toBeNull();
  });
});
