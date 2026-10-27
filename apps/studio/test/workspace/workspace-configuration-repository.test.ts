// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { expect, it } from 'vitest';
import { createProjectController } from '../../src/workspace/project-controller.js';
import { createProjectFileAdapter } from '../../src/workspace/project-file-adapter.js';
import { createOpfsRoot } from '../setup/opfs-mock.js';
import { saveWorkspaceConfiguration } from '../../src/workspace/workspace-configuration-repository.js';

async function setup() {
  const adapter = createProjectFileAdapter({
    workspaceId: 'settings',
    root: createOpfsRoot() as unknown as FileSystemDirectoryHandle,
    privateRoot: createOpfsRoot() as unknown as FileSystemDirectoryHandle,
    isWritable: () => true
  });
  const controller = createProjectController({ workspaceId: 'settings', adapter, validateTarget: () => [] });
  await controller.load();
  return controller;
}

it('saves actual Studio directories with YAML comments, unknown fields and original files retained', async () => {
  const controller = await setup();
  const original =
    '# Shared directories\nschemaVersion: 1\nexamples: examples # examples live here\ncustom: retained\n';
  await controller.save([
    { path: 'studio-config.yaml', text: original, expectedRevision: null },
    { path: 'examples/retained.json', text: '{}', expectedRevision: null }
  ]);
  const result = await saveWorkspaceConfiguration(controller, controller.current()!, {
    schemaVersion: 1,
    examples: 'data/examples',
    workflows: 'flows',
    layouts: 'layouts'
  });
  expect(result.project.studio).toEqual({
    schemaVersion: 1,
    examples: 'data/examples',
    workflows: 'flows',
    layouts: 'layouts'
  });
  expect(result.files.get('studio-config.yaml')).toContain('# Shared directories');
  expect(result.files.get('studio-config.yaml')).toContain('# examples live here');
  expect(result.files.get('studio-config.yaml')).toContain('custom: retained');
  expect(result.files.has('studio-config.yml')).toBe(false);
  expect(result.files.get('examples/retained.json')).toBe('{}');
});

it('creates the canonical companion and refuses stale or invalid changes without overwriting newer YAML', async () => {
  const controller = await setup();
  await saveWorkspaceConfiguration(controller, controller.current()!, {
    schemaVersion: 1,
    examples: 'examples',
    workflows: 'workflows',
    layouts: 'layouts'
  });
  const stale = controller.current()!;
  const newer = await saveWorkspaceConfiguration(controller, stale, { ...stale.project.studio, examples: 'newer' });
  await expect(
    saveWorkspaceConfiguration(controller, stale, { ...stale.project.studio, examples: 'stale' })
  ).rejects.toThrow();
  expect(controller.current()!.files.get('studio-config.yml')).toBe(newer.files.get('studio-config.yml'));
  await expect(
    saveWorkspaceConfiguration(controller, newer, { ...newer.project.studio, examples: '' })
  ).rejects.toThrow();
  expect(controller.current()!.files.get('studio-config.yml')).toBe(newer.files.get('studio-config.yml'));
});
