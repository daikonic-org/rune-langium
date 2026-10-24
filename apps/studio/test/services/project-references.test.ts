// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { it, expect, vi } from 'vitest';
import { referenceFixture } from '../../../../test/helpers/project-reference-fixture.js';
import { createProjectFileAdapter } from '../../src/workspace/project-file-adapter.js';
import { createProjectController } from '../../src/workspace/project-controller.js';
import { createOpfsRoot } from '../setup/opfs-mock.js';
import { createMemoryReferenceCache } from '@rune-langium/project-runtime/references';
import {
  createProjectReferenceTransport,
  resolveAndSaveProjectReferences,
  loadProjectReferences
} from '../../src/services/project-references.js';
async function setup() {
  const reference = await referenceFixture();
  const adapter = createProjectFileAdapter({
    workspaceId: 'p',
    root: createOpfsRoot() as unknown as FileSystemDirectoryHandle,
    privateRoot: createOpfsRoot() as unknown as FileSystemDirectoryHandle,
    isWritable: () => true
  });
  for (const [path, text] of reference.snapshot.files) await adapter.write(path, text, null);
  const controller = createProjectController({ workspaceId: 'p', adapter, validateTarget: () => [] });
  await controller.load();
  return { ...reference, adapter, controller };
}
it('saves verified reference locks and reopens offline without a catalog lookup', async () => {
  const { controller, adapter, transport } = await setup();
  const cache = createMemoryReferenceCache();
  const saved = await resolveAndSaveProjectReferences(controller, transport, cache, new AbortController().signal);
  expect(saved.lock!.references.cdm!.release).toBe('1.0');
  expect(await adapter.read('build-config.lock.json')).toBeDefined();
  transport.catalog.mockClear();
  transport.artifact.mockImplementation(async () => {
    throw new Error('offline');
  });
  const reopened = await loadProjectReferences(saved, transport, cache, new AbortController().signal);
  expect(reopened.documents).toHaveLength(2);
  expect(transport.catalog).not.toHaveBeenCalled();
});
it('discards a stale upgrade and preserves the previously saved configuration and lock', async () => {
  const { controller, adapter, transport, releases } = await setup();
  const cache = createMemoryReferenceCache();
  const saved = await resolveAndSaveProjectReferences(controller, transport, cache, new AbortController().signal);
  const lockBefore = (await adapter.read('build-config.lock.json'))!.text;
  let finish!: (value: Awaited<ReturnType<typeof transport.catalog>>) => void;
  transport.catalog.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const next = structuredClone(saved.project.build);
  next.references.cdm!.release = '2.0';
  const pending = resolveAndSaveProjectReferences(controller, transport, cache, new AbortController().signal, next);
  while (!finish) await new Promise((resolve) => setTimeout(resolve, 0));
  await controller.save([{ path: 'examples/new.json', text: '{}', expectedRevision: null }]);
  finish({ schemaVersion: 1, releases: releases.get('cdm')! });
  await expect(pending).rejects.toThrow(/changed|stale/);
  expect((await adapter.read('build-config.lock.json'))!.text).toBe(lockBefore);
  expect(controller.current()!.project.build.references.cdm!.release).toBe('1.0');
});
it('rejects stale lock requests and confines its transport to the configured mirror', async () => {
  const { controller, transport } = await setup();
  const cache = createMemoryReferenceCache();
  const saved = await resolveAndSaveProjectReferences(controller, transport, cache, new AbortController().signal);
  const changed = {
    ...saved,
    project: {
      ...saved.project,
      build: {
        ...saved.project.build,
        references: { cdm: { repository: saved.project.build.references.cdm!.repository, release: '2.0' } }
      }
    }
  };
  expect((await loadProjectReferences(changed, transport, cache, new AbortController().signal)).documents).toEqual([]);
  const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ schemaVersion: 1, releases: [] }));
  const network = createProjectReferenceTransport(fetcher, 'https://mirror.example/curated');
  await network.catalog('cdm', new AbortController().signal);
  expect(fetcher.mock.calls[0]?.[0]).toBe('https://mirror.example/releases/cdm');
  await expect(
    network.artifact('https://other.example/curated/cdm/artifacts/x.json', new AbortController().signal)
  ).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('updates an explicit upgrade configuration and lock in the same project Save', async () => {
  const { controller, transport } = await setup();
  const cache = createMemoryReferenceCache();
  const before = await resolveAndSaveProjectReferences(controller, transport, cache, new AbortController().signal);
  const next = structuredClone(before.project.build);
  next.references.cdm!.release = '2.0';
  const upgraded = await resolveAndSaveProjectReferences(
    controller,
    transport,
    cache,
    new AbortController().signal,
    next
  );
  expect(upgraded.project.build.references.cdm!.release).toBe('2.0');
  expect(upgraded.lock!.references.cdm!.release).toBe('2.0');
  expect(upgraded.lock!.references['rune-dsl']!.release).toBe('2.0');
  expect((await loadProjectReferences(upgraded, transport, cache, new AbortController().signal)).diagnostics).toEqual(
    []
  );
});
it('does not replace an existing lock after a canceled upgrade', async () => {
  const { controller, adapter, transport, releases } = await setup();
  const cache = createMemoryReferenceCache();
  const before = await resolveAndSaveProjectReferences(controller, transport, cache, new AbortController().signal);
  const lockBefore = (await adapter.read('build-config.lock.json'))!.text;
  let finish!: (value: Awaited<ReturnType<typeof transport.catalog>>) => void;
  transport.catalog.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const abort = new AbortController();
  const next = structuredClone(before.project.build);
  next.references.cdm!.release = '2.0';
  const pending = resolveAndSaveProjectReferences(controller, transport, cache, abort.signal, next);
  while (!finish) await new Promise((resolve) => setTimeout(resolve, 0));
  abort.abort();
  finish({ schemaVersion: 1, releases: releases.get('cdm')! });
  await expect(pending).rejects.toThrow();
  expect((await adapter.read('build-config.lock.json'))!.text).toBe(lockBefore);
});
