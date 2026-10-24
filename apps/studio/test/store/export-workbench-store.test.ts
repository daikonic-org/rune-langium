// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, expect, it, vi } from 'vitest';

const { mockReadWorkbenchSettings, mockWriteWorkbenchSettings } = vi.hoisted(() => ({
  mockReadWorkbenchSettings: vi.fn(),
  mockWriteWorkbenchSettings: vi.fn()
}));

vi.mock('../../src/shell/workbench-settings.js', () => ({
  readWorkbenchSettings: mockReadWorkbenchSettings,
  writeWorkbenchSettings: mockWriteWorkbenchSettings
}));

import { validateProjectTarget } from '@rune-langium/project-runtime/browser';
import { createExportWorkbench } from '../../src/store/export-workbench-store.js';
import { exportInputKey, type ExportInput } from '../../src/services/export-request.js';
import { createProjectFileAdapter } from '../../src/workspace/project-file-adapter.js';
import { createProjectController } from '../../src/workspace/project-controller.js';
import { createOpfsRoot } from '../setup/opfs-mock.js';
import type { ExportArtifact } from '../../src/services/export-artifact.js';

const input: ExportInput = {
  workspaceId: 'test',
  sourceRevision: 1,
  config: {
    target: 'typescript',
    selection: { namespaces: ['test'], declarations: [] },
    options: { typescript: { layout: 'barrel' } }
  },
  files: [{ name: 'test.rune', path: 'test.rune', content: 'namespace test', dirty: false }]
};

const artifact: ExportArtifact = {
  blob: new Blob(),
  filename: 'test.zip',
  manifest: { version: 1, target: 'typescript', files: [], diagnostics: [] },
  readText: async () => ''
};

afterEach(() => {
  mockReadWorkbenchSettings.mockReset();
  mockWriteWorkbenchSettings.mockReset();
});

it('rejects a completed result after its inputs change', async () => {
  let finish!: (result: ExportArtifact) => void;
  const generate = vi.fn(
    () =>
      new Promise<ExportArtifact>((resolve) => {
        finish = resolve;
      })
  );
  const store = createExportWorkbench(generate);

  const pending = store.getState().generate(input);
  store.getState().invalidate(input.sourceRevision + 1);
  finish(artifact);
  await pending;

  expect(store.getState().run.status).not.toBe('ready');
});

it('retains a completed artifact as stale when configuration changes', async () => {
  const store = createExportWorkbench(async () => artifact);

  await store.getState().generate(input);
  store.getState().configure({ ...input.config, target: 'zod' });

  expect(store.getState().run).toEqual({
    status: 'stale',
    inputKey: exportInputKey(input),
    artifact
  });
});

it('keeps an existing stale artifact through later configuration and source changes', async () => {
  const store = createExportWorkbench(async () => artifact);

  await store.getState().generate(input);
  store.getState().configure({ ...input.config, target: 'zod' });
  store.getState().configure({ ...input.config, target: 'json-schema' });
  store.getState().invalidate(input.sourceRevision + 1);

  expect(store.getState().run).toMatchObject({ status: 'stale', artifact });
});

it('restores the previous export when regeneration is canceled', async () => {
  let finish!: (result: ExportArtifact) => void;
  const generate = vi
    .fn()
    .mockResolvedValueOnce(artifact)
    .mockImplementationOnce(() => new Promise<ExportArtifact>((resolve) => (finish = resolve)));
  const store = createExportWorkbench(generate);

  await store.getState().generate(input);
  const pending = store.getState().generate({ ...input, sourceRevision: 2 });
  expect(store.getState().run).toMatchObject({ status: 'generating', previous: { artifact } });

  store.getState().cancel();
  expect(store.getState().run).toEqual({ status: 'stale', inputKey: exportInputKey(input), artifact });
  finish({ ...artifact, filename: 'new.zip' });
  await pending;
  expect(store.getState().run).toMatchObject({ status: 'stale', artifact });
});

it('retains the previous export and diagnostics when regeneration fails', async () => {
  const generate = vi.fn().mockResolvedValueOnce(artifact).mockRejectedValueOnce(new Error('Worker failed'));
  const store = createExportWorkbench(generate);

  await store.getState().generate(input);
  await store.getState().generate({ ...input, sourceRevision: 2 });

  expect(store.getState().run).toEqual({
    status: 'failed',
    message: 'Worker failed',
    diagnostics: [],
    previous: { inputKey: exportInputKey(input), artifact }
  });
  store.getState().configure({ ...input.config, target: 'zod' });
  expect(store.getState().run).toMatchObject({ status: 'stale', artifact });
});

it('uses the same key for option objects with different insertion order', () => {
  const reordered: ExportInput = {
    ...input,
    config: {
      ...input.config,
      options: { typescript: { layout: 'barrel' }, unrelated: { z: 1, a: 2 } }
    }
  };
  const original: ExportInput = {
    ...input,
    config: {
      ...input.config,
      options: { unrelated: { a: 2, z: 1 }, typescript: { layout: 'barrel' } }
    }
  };
  expect(exportInputKey(reordered)).toBe(exportInputKey(original));
});

it('retains structured diagnostics for a failed export', async () => {
  const store = createExportWorkbench(async () => {
    throw Object.assign(new Error('Unknown selection'), {
      diagnostics: [{ severity: 'error', code: 'unknown-export-selection', message: 'Party is unavailable' }]
    });
  });

  await store.getState().generate(input);

  expect(store.getState().run).toEqual({
    status: 'failed',
    message: 'Unknown selection',
    diagnostics: [{ severity: 'error', code: 'unknown-export-selection', message: 'Party is unavailable' }]
  });
});

it('restores and persists preferences by workspace without retaining the artifact', async () => {
  mockReadWorkbenchSettings.mockResolvedValue({
    config: { ...input.config, target: 'zod' },
    activeFile: 'test/index.ts'
  });
  const store = createExportWorkbench(vi.fn());

  await store.getState().activate('workspace-a');

  expect(store.getState()).toMatchObject({
    workspaceId: 'workspace-a',
    config: { target: 'zod', selection: input.config.selection },
    activeFile: 'test/index.ts',
    run: { status: 'idle' }
  });
  store.getState().setActiveFile('test/model.ts');
  expect(mockWriteWorkbenchSettings).toHaveBeenCalledWith('workspace-a', 'export-workbench', {
    config: expect.objectContaining({ target: 'zod' }),
    activeFile: 'test/model.ts'
  });
});

it('keeps local export preferences when they change during activation', async () => {
  let restore!: (value: { config: ExportInput['config']; activeFile: string }) => void;
  mockReadWorkbenchSettings.mockImplementation(
    () => new Promise<{ config: ExportInput['config']; activeFile: string }>((resolve) => (restore = resolve))
  );
  const store = createExportWorkbench(vi.fn());
  const localConfig: ExportInput['config'] = {
    ...input.config,
    selection: { namespaces: ['local'], declarations: [] }
  };

  const activating = store.getState().activate('workspace-a');
  store.getState().configure(localConfig);
  store.getState().setActiveFile('local.ts');
  restore({ config: { ...input.config, target: 'zod' }, activeFile: 'restored.ts' });
  await activating;

  expect(store.getState()).toMatchObject({ config: localConfig, activeFile: 'local.ts' });
});

async function projectSetup() {
  const adapter = createProjectFileAdapter({
    workspaceId: 'test',
    root: createOpfsRoot() as unknown as FileSystemDirectoryHandle,
    privateRoot: createOpfsRoot() as unknown as FileSystemDirectoryHandle,
    isWritable: () => true
  });
  await adapter.write('rune-config.yml', 'model: {name: Test}\n', null);
  await adapter.write('model/test.rosetta', 'namespace test\ntype Party:\n name string (1..1)\n', null);
  await adapter.write(
    'build-config.yml',
    `# Keep me
schemaVersion: 1
targets:
  pg:
    generator: sql
    output: generated/pg
    options: {dialect: postgres}
  ss:
    generator: sql
    output: generated/ss
    options: {dialect: sqlserver}
`,
    null
  );
  const controller = createProjectController({ workspaceId: 'test', adapter, validateTarget: validateProjectTarget });
  await controller.load();
  const store = createExportWorkbench(async () => artifact);
  store.getState().bindProject(controller, 'Test');
  return { adapter, controller, store };
}

it('does not auto-select a saved target and switches independent SQL settings', async () => {
  const { store } = await projectSetup();
  expect(store.getState().selectedTargetName).toBeUndefined();
  store.getState().selectTarget('pg');
  expect(store.getState().config.options.sql).toEqual({ dialect: 'postgres' });
  store.getState().configure({ ...store.getState().config, options: { sql: { dialect: 'sqlserver' } } });
  store.getState().selectTarget('ss');
  expect(store.getState().config.options.sql).toEqual({ dialect: 'sqlserver' });
  store.getState().selectTarget('pg');
  expect(store.getState().config.options.sql).toEqual({ dialect: 'postgres' });
});
it('keeps one-off edits isolated and explicitly saves options without run roots', async () => {
  const { store, adapter, controller } = await projectSetup();
  const before = (await adapter.read('build-config.yml'))!.text;
  store.getState().selectTarget('pg');
  const draft = {
    ...store.getState().config,
    selection: { namespaces: ['adHoc'], declarations: [] },
    options: { sql: { dialect: 'sqlserver' } }
  };
  store.getState().configure(draft);
  expect((await adapter.read('build-config.yml'))!.text).toBe(before);
  await store.getState().saveTarget('pg', draft);
  const persisted = (await adapter.read('build-config.yml'))!.text;
  expect(persisted).toContain('# Keep me');
  expect(persisted).not.toContain('adHoc');
  expect(controller.current()!.project.build.targets.pg!.options).toEqual({ dialect: 'sqlserver' });
  const reopened = createExportWorkbench();
  reopened.getState().bindProject(controller, 'Test');
  reopened.getState().selectTarget('pg');
  expect(reopened.getState().config.options.sql).toEqual({ dialect: 'sqlserver' });
  expect(reopened.getState().config.selection.namespaces).toEqual([]);
});
it('refreshes clean target options after YAML edits, preserving dirty drafts', async () => {
  const { store, adapter, controller } = await projectSetup();
  store.getState().selectTarget('pg');
  const file = (await adapter.read('build-config.yml'))!;
  await controller.save([
    { path: 'build-config.yml', text: file.text.replace('postgres', 'sqlserver'), expectedRevision: file.revision }
  ]);
  expect(store.getState().config.options.sql).toEqual({ dialect: 'sqlserver' });
  store.getState().configure({
    ...store.getState().config,
    options: { sql: { dialect: 'postgres', inheritance: 'table-per-type' } }
  });
  const next = (await adapter.read('build-config.yml'))!;
  await controller.save([
    { path: 'build-config.yml', text: next.text.replace('sqlserver', 'postgres'), expectedRevision: next.revision }
  ]);
  expect(store.getState().config.options.sql).toEqual({ dialect: 'postgres', inheritance: 'table-per-type' });
  expect(store.getState().targetDirty).toBe(true);
});
it('invalidates captured output when configuration or lock files change', async () => {
  const { store, controller } = await projectSetup();
  await store.getState().generate(input);
  await controller.save([
    {
      path: 'build-config.lock.json',
      text: JSON.stringify({ schemaVersion: 1, configHash: 'a'.repeat(64), toolchain: {}, references: {} }),
      expectedRevision: null
    }
  ]);
  expect(store.getState().run.status).toBe('stale');
});

it('builds explicit targets through the server generator and writes all saved output paths', async () => {
  const { adapter, controller } = await projectSetup();
  const generate = vi.fn(async (request: ExportInput) => ({
    ...artifact,
    manifest: {
      ...artifact.manifest,
      target: request.config.target,
      files: [{ path: 'schema.sql', kind: 'text' as const, bytes: request.config.options.sql ? 3 : 0 }]
    },
    readText: async () => 'SQL'
  }));
  const store = createExportWorkbench(generate);
  store.getState().bindProject(controller, 'Test');
  await store.getState().buildTargets('all', input);
  expect(generate).toHaveBeenCalledTimes(2);
  expect(generate.mock.calls.map(([request]) => request.config.options.sql)).toEqual([
    { dialect: 'postgres' },
    { dialect: 'sqlserver' }
  ]);
  expect((await adapter.read('generated/pg/schema.sql'))?.text).toBe('SQL');
  expect((await adapter.read('generated/ss/schema.sql'))?.text).toBe('SQL');
  expect(store.getState().run.status).toBe('ready');
});

it('rejects a target Save based on configuration that changed outside the editor', async () => {
  const { adapter, store } = await projectSetup();
  store.getState().selectTarget('pg');
  const draft = { ...store.getState().config, options: { sql: { dialect: 'sqlserver' } } };
  store.getState().configure(draft);
  const file = (await adapter.read('build-config.yml'))!;
  await adapter.write('build-config.yml', file.text + '# collaborator\n', file.revision);
  await expect(store.getState().saveTarget('pg', draft)).rejects.toThrow();
  expect((await adapter.read('build-config.yml'))!.text).toBe(file.text + '# collaborator\n');
});

it('does not publish a successful build when an empty artifact contains fatal diagnostics', async () => {
  const { adapter, controller } = await projectSetup();
  const store = createExportWorkbench(async () => ({
    ...artifact,
    manifest: {
      ...artifact.manifest,
      target: 'sql',
      diagnostics: [{ severity: 'error', code: 'unsupported', message: 'Unsupported model construct' }]
    }
  }));
  store.getState().bindProject(controller, 'Test');
  await store.getState().buildTargets(['pg'], input);
  expect(store.getState().run.status).toBe('failed');
  expect((await adapter.list()).some((path) => path.startsWith('generated/'))).toBe(false);
});

it('does not resolve inherited object keys as saved targets', async () => {
  const { store } = await projectSetup();
  store.getState().selectTarget('constructor');
  expect(store.getState().selectedTargetName).toBeUndefined();
  expect(store.getState().config.target).toBe('typescript');
});

it('retains the mid-generation freshness guard and writes no outputs after source changes', async () => {
  const { adapter, controller } = await projectSetup();
  const store = createExportWorkbench(async () => {
    const file = (await adapter.read('model/test.rosetta'))!;
    await adapter.write('model/test.rosetta', file.text + ' amount number (0..1)\n', file.revision);
    return {
      ...artifact,
      manifest: { ...artifact.manifest, files: [{ path: 'schema.sql', kind: 'text', bytes: 3 }] },
      readText: async () => 'SQL'
    };
  });
  store.getState().bindProject(controller, 'Test');
  await store.getState().buildTargets(['pg'], input);
  expect(store.getState().run.status).toBe('failed');
  expect((await adapter.list()).some((path) => path.startsWith('generated/'))).toBe(false);
});
