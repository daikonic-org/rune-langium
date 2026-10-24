// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { saveWorkspace } from './persistence.js';
import { createProjectController } from './project-controller.js';
import { validateProjectTarget } from '@rune-langium/project-runtime/browser';
import type { WorkspaceManager } from './workspace-manager.js';
import { PortableProjectPathSchema } from '@rune-langium/project-config';
import type { StarterProject } from '../services/starter-registry.js';
import { withInstrumentation } from '../services/instrumentation/core.js';

export interface StarterProvenance {
  repository: string;
  commit: string;
}
export interface StarterSource {
  files: ReadonlyMap<string, string>;
  commit: string;
}
export interface StarterAdapters {
  source(starter: StarterProject, signal: AbortSignal): Promise<StarterSource>;
  create(input: {
    name: string;
    files: ReadonlyMap<string, string>;
    provenance: StarterProvenance;
    signal: AbortSignal;
  }): Promise<{ workspaceId: string }>;
}
/** The copy boundary deliberately has no credential, reference-only or Git remote option. */
export const createStarterOpener = withInstrumentation(
  function createStarterOpener(adapters: StarterAdapters) {
    return async function openStarter({ starter, signal }: { starter: StarterProject; signal: AbortSignal }) {
      signal.throwIfAborted();
      if (starter.status !== 'available')
        throw new Error('This example project is unavailable until its repository is published and verified.');
      if (!/^[\w.-]+\/[\w.-]+$/.test(starter.repository)) throw new Error('Invalid starter repository.');
      const source = await adapters.source(starter, signal);
      signal.throwIfAborted();
      if (!/^[a-f0-9]{40}$/.test(source.commit)) throw new Error('The starter source did not provide an exact commit.');
      if (/^[a-f0-9]{40}$/.test(starter.ref) && starter.ref !== source.commit)
        throw new Error('The starter commit changed.');
      const files = new Map<string, string>();
      let bytes = 0;
      for (const [path, text] of source.files) {
        if (!PortableProjectPathSchema.safeParse(path).success) throw new Error('Invalid starter source path.');
        bytes += new TextEncoder().encode(text).byteLength;
        if (bytes > 8 * 1024 * 1024 || files.size >= 512)
          throw new Error('This starter exceeds the supported project size.');
        files.set(path, text);
      }
      if (![...files.keys()].some((path) => path.endsWith('.rosetta')))
        throw new Error('The starter contains no Rune source files.');
      const provenance = { repository: starter.repository, commit: source.commit };
      const created = await adapters.create({ name: starter.name, files, provenance, signal });
      signal.throwIfAborted();
      return { ...created, provenance };
    };
  },
  { op: 'createStarterOpener', capture: 0 }
);

/** Writes the checked file set before activation; interrupted copies remain recoverable in recents. */
export const createStarterWorkingCopy = withInstrumentation(
  async function createStarterWorkingCopy(manager: WorkspaceManager, input: Parameters<StarterAdapters['create']>[0]) {
    input.signal.throwIfAborted();
    const workspace = await manager.create(input.name);
    const adapter = await manager.getProjectFileAdapter(workspace.id);
    const controller = createProjectController({
      workspaceId: workspace.id,
      adapter,
      validateTarget: validateProjectTarget
    });
    try {
      await controller.load();
      input.signal.throwIfAborted();
      await controller.save([...input.files].map(([path, text]) => ({ path, text, expectedRevision: null })));
      await saveWorkspace({ ...workspace, starterProvenance: input.provenance });
      input.signal.throwIfAborted();
      return { workspaceId: workspace.id };
    } finally {
      controller.dispose();
    }
  },
  { op: 'createStarterWorkingCopy', capture: 0 }
);
