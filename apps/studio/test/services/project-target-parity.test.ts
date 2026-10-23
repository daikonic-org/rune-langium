// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { it, expect, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createOpfsRoot } from '../setup/opfs-mock.js';
import { createProjectFileAdapter } from '../../src/workspace/project-file-adapter.js';
import { createProjectController } from '../../src/workspace/project-controller.js';
import { createExportWorkbench } from '../../src/store/export-workbench-store.js';
import { generateExport } from '../../src/services/export-request.js';
import { validateProjectTarget } from '@rune-langium/project-runtime/browser';
vi.mock('../../src/services/codegen-download-client.js', () => ({
  requestCodegenDownload: async (body: unknown) => {
    const { handleCodegenDownload } = await import('../../src/services/codegen-download-handler.js');
    return handleCodegenDownload({
      request: new Request('http://localhost/api/codegen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
    });
  }
}));

it('writes identical SQL bytes from Studio and the actual native CLI using the same saved targets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rune-target-parity-'));
  const project = join(dir, 'project');
  const adapter = createProjectFileAdapter({
    workspaceId: 'parity',
    root: createOpfsRoot() as unknown as FileSystemDirectoryHandle,
    privateRoot: createOpfsRoot() as unknown as FileSystemDirectoryHandle,
    isWritable: () => true
  });
  const files = new Map([
    ['model/party.rosetta', 'namespace demo\ntype Party:\n name string (1..1)'],
    ['rune-config.yml', 'model: {name: Demo}\n'],
    [
      'build-config.yml',
      'schemaVersion: 1\ntargets:\n pg: {generator: sql, output: generated/pg, options: {dialect: postgres}}\n ss: {generator: sql, output: generated/ss, options: {dialect: sqlserver}}\n'
    ]
  ]);
  try {
    for (const [path, text] of files) {
      await adapter.write(path, text, null);
      await mkdir(dirname(join(project, path)), { recursive: true });
      await writeFile(join(project, path), text);
    }
    const controller = createProjectController({
      workspaceId: 'parity',
      adapter,
      validateTarget: validateProjectTarget
    });
    await controller.load();
    const store = createExportWorkbench(generateExport);
    store.getState().bindProject(controller, 'Demo');
    await store
      .getState()
      .buildTargets('all', { workspaceId: 'parity', sourceRevision: 1, files: [], config: store.getState().config });
    expect(store.getState().run.status).toBe('ready');
    const result = await promisify(execFile)(
      process.execPath,
      [resolve('../../packages/cli/dist/index.js'), 'build', '--project', project, '--all', '--json'],
      { env: { ...process.env, XDG_CACHE_HOME: join(dir, 'private-cache') } }
    );
    const report = JSON.parse(result.stdout);
    expect(report.status).toBe('success');
    expect(report.outputs.length).toBeGreaterThanOrEqual(2);
    for (const path of report.outputs)
      expect((await adapter.read(path))?.text, path).toBe(await readFile(join(project, path), 'utf8'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 15000);
