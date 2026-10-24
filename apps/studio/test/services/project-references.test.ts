// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { it, expect, vi } from 'vitest';
import { referenceFixture } from '../../../../test/helpers/project-reference-fixture.js';
import { createProjectFileAdapter } from '../../src/workspace/project-file-adapter.js';
import { createProjectController } from '../../src/workspace/project-controller.js';
import { createOpfsRoot } from '../setup/opfs-mock.js';
import { createMemoryReferenceCache } from '@rune-langium/project-runtime/references';
import {
  prepareProjectReferenceChange,
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

it('prepares a verified review without writing, then accepts exactly the captured config and lock', async () => {
  const { controller, adapter, transport } = await setup();
  const cache = createMemoryReferenceCache();
  const original = controller.current()!;
  const review = await prepareProjectReferenceChange(controller, transport, cache, new AbortController().signal);
  expect(controller.current()).toEqual(original);
  expect(await adapter.read('build-config.lock.json')).toBeUndefined();
  expect(review.lock.references.cdm!.release).toBe('1.0');
  expect(review.lock.references['rune-dsl']!.release).toBe('1.0');
  review.config.references.cdm!.release = 'not-the-reviewed-request';
  const saved = await review.accept(new AbortController().signal);
  expect(saved.project.build.references.cdm!.release).toBe('1.0');
  expect(saved.lock).toEqual(review.lock);
});
it('refuses a canceled or stale review and leaves the old active release usable', async () => {
  const { controller, transport } = await setup();
  const cache = createMemoryReferenceCache();
  const before = await resolveAndSaveProjectReferences(controller, transport, cache, new AbortController().signal);
  const next = structuredClone(before.project.build);
  next.references.cdm!.release = '2.0';
  const review = await prepareProjectReferenceChange(controller, transport, cache, new AbortController().signal, next);
  const abort = new AbortController();
  abort.abort();
  await expect(review.accept(abort.signal)).rejects.toThrow();
  expect(controller.current()!.lock).toEqual(before.lock);
  await controller.save([{ path: 'examples/change.json', text: '{}', expectedRevision: null }]);
  await expect(review.accept(new AbortController().signal)).rejects.toThrow(/changed|stale/);
  expect(
    (await loadProjectReferences(controller.current()!, transport, cache, new AbortController().signal)).documents
  ).toHaveLength(2);
});
it('distinguishes missing locks, unavailable bytes and checksum failures without changing the saved release', async () => {
  const { controller, adapter, transport } = await setup();
  const cache = createMemoryReferenceCache();
  expect(
    (await loadProjectReferences(controller.current()!, transport, cache, new AbortController().signal)).diagnostics[0]
      ?.code
  ).toMatch(/LOCK/);
  const before = await resolveAndSaveProjectReferences(controller, transport, cache, new AbortController().signal);
  const next = structuredClone(before.project.build);
  next.references.cdm!.release = '2.0';
  transport.artifact.mockResolvedValueOnce(new TextEncoder().encode('corrupt'));
  await expect(
    prepareProjectReferenceChange(controller, transport, cache, new AbortController().signal, next)
  ).rejects.toMatchObject({
    diagnostics: expect.arrayContaining([expect.objectContaining({ code: 'REFERENCE_CHECKSUM' })])
  });
  expect(controller.current()!.lock).toEqual(before.lock);
  const empty = createMemoryReferenceCache();
  transport.artifact.mockRejectedValue(new Error('Offline cache miss'));
  expect(
    (await loadProjectReferences(before, transport, empty, new AbortController().signal)).diagnostics[0]?.code
  ).toBe('REFERENCE_UNAVAILABLE');
  expect(JSON.parse((await adapter.read('build-config.lock.json'))!.text)).toEqual(before.lock);
});
it('refuses incompatible second versions rather than replacing a transitive requirement silently', async () => {
  const { controller, transport } = await setup();
  const next = structuredClone(controller.current()!.project.build);
  next.references['rune-dsl'] = { repository: 'https://github.com/org/rune-dsl', release: '2.0' };
  await expect(
    prepareProjectReferenceChange(
      controller,
      transport,
      createMemoryReferenceCache(),
      new AbortController().signal,
      next
    )
  ).rejects.toMatchObject({
    diagnostics: expect.arrayContaining([expect.objectContaining({ code: 'REFERENCE_CONFLICT' })])
  });
  expect(controller.current()!.lock).toBeUndefined();
});

it('reports removed override endpoints and saved example/workflow identities before accepting an upgrade', async () => {
  const original = await referenceFixture(undefined, undefined, {
    cdm: 'namespace ref\ntype Gone:\n value number (1..1)\nfunc Compute:\n inputs: value number (1..1)\n output: result number (1..1)\n set result: value'
  });
  const adapter = createProjectFileAdapter({
    workspaceId: 'compat',
    root: createOpfsRoot() as unknown as FileSystemDirectoryHandle,
    privateRoot: createOpfsRoot() as unknown as FileSystemDirectoryHandle,
    isWritable: () => true
  });
  for (const [path, text] of original.snapshot.files) await adapter.write(path, text, null);
  const controller = createProjectController({ workspaceId: 'compat', adapter, validateTarget: () => [] });
  await controller.load();
  const cache = createMemoryReferenceCache();
  await resolveAndSaveProjectReferences(controller, original.transport, cache, new AbortController().signal);
  const source = { model: 'cdm', namespace: 'ref', kind: 'RosettaFunction', name: 'Compute' };
  const type = { model: 'cdm', namespace: 'ref', kind: 'Data', name: 'Gone' };
  const config = {
    ...controller.current()!.project.build,
    overrides: [{ kind: 'declaration', source, replacement: { ...source, model: 'local', namespace: 'custom' } }]
  };
  await controller.save([
    {
      path: 'build-config.yml',
      text: JSON.stringify(config),
      expectedRevision: (await adapter.read('build-config.yml'))!.revision
    },
    {
      path: 'model/local.rosetta',
      text: 'namespace custom\nfunc Compute:\n inputs: value number (1..1)\n output: result number (1..1)\n set result: value * 2',
      expectedRevision: null
    },
    {
      path: 'examples/old.example.json',
      text: JSON.stringify({
        schemaVersion: 1,
        id: 'old',
        name: 'Old input',
        type,
        payload: 'examples/old.json',
        codec: 'JSON'
      }),
      expectedRevision: null
    },
    { path: 'examples/old.json', text: '{"value":10}', expectedRevision: null },
    {
      path: 'workflows/old.workflow.json',
      text: JSON.stringify({
        schemaVersion: 1,
        id: 'old',
        name: 'Old recipe',
        function: source,
        inputs: { value: { kind: 'literal', value: 10 } },
        outputs: {}
      }),
      expectedRevision: null
    }
  ]);
  const before = controller.current()!;
  const newer = await referenceFixture(undefined, undefined, {
    cdm: 'namespace ref\ntype Different:\n name string (1..1)'
  });
  const next = structuredClone(before.project.build);
  next.references.cdm!.release = '2.0';
  const review = await prepareProjectReferenceChange(
    controller,
    newer.transport,
    cache,
    new AbortController().signal,
    next
  );
  expect(review.diagnostics).toContainEqual(expect.objectContaining({ code: expect.stringMatching(/^OVERRIDE_/) }));
  expect(review.diagnostics).toContainEqual(
    expect.objectContaining({
      code: 'EXAMPLE_TYPE_UNAVAILABLE',
      path: 'examples/old.example.json',
      message: expect.stringContaining('ref.Gone')
    })
  );
  expect(review.diagnostics).toContainEqual(
    expect.objectContaining({
      code: 'WORKFLOW_SYMBOL_UNAVAILABLE',
      path: 'workflows/old.workflow.json',
      message: expect.stringContaining('ref.Compute')
    })
  );
  expect(controller.current()).toEqual(before);
  expect((await adapter.read('build-config.lock.json'))!.text).toBe(before.files.get('build-config.lock.json'));
  await expect(review.accept(new AbortController().signal)).rejects.toThrow();
});

it('previews changed schemas and callable inputs for saved bindings without replacing the active lock', async () => {
  const original = await referenceFixture(undefined, undefined, {
    cdm: 'namespace ref\ntype Quote:\n amount number (1..1)\nfunc Compute:\n inputs: value number (1..1)\n output: result number (1..1)\n set result: value'
  });
  const adapter = createProjectFileAdapter({
    workspaceId: 'schema-review',
    root: createOpfsRoot() as unknown as FileSystemDirectoryHandle,
    privateRoot: createOpfsRoot() as unknown as FileSystemDirectoryHandle,
    isWritable: () => true
  });
  for (const [path, text] of original.snapshot.files) await adapter.write(path, text, null);
  const controller = createProjectController({ workspaceId: 'schema-review', adapter, validateTarget: () => [] });
  await controller.load();
  const cache = createMemoryReferenceCache();
  await resolveAndSaveProjectReferences(controller, original.transport, cache, new AbortController().signal);
  await controller.save([
    {
      path: 'examples/quote.example.json',
      text: JSON.stringify({
        schemaVersion: 1,
        id: 'quote',
        name: 'Quote',
        type: { model: 'cdm', namespace: 'ref', kind: 'Data', name: 'Quote' },
        payload: 'examples/quote.json',
        codec: 'JSON'
      }),
      expectedRevision: null
    },
    { path: 'examples/quote.json', text: '{"amount":10}', expectedRevision: null },
    {
      path: 'workflows/compute.workflow.json',
      text: JSON.stringify({
        schemaVersion: 1,
        id: 'compute',
        name: 'Compute',
        function: { model: 'cdm', namespace: 'ref', kind: 'RosettaFunction', name: 'Compute' },
        inputs: { value: { kind: 'literal', value: 10 } },
        outputs: {}
      }),
      expectedRevision: null
    }
  ]);
  const before = controller.current()!;
  const newer = await referenceFixture(undefined, undefined, {
    cdm: 'namespace ref\ntype Quote:\n amount string (1..1)\nfunc Compute:\n inputs: value string (1..1)\n output: result string (1..1)\n set result: value'
  });
  const next = structuredClone(before.project.build);
  next.references.cdm!.release = '2.0';
  const review = await prepareProjectReferenceChange(
    controller,
    newer.transport,
    cache,
    new AbortController().signal,
    next
  );
  expect(review.diagnostics).toContainEqual(
    expect.objectContaining({
      code: 'REFERENCE_SCHEMA_CHANGED',
      path: 'examples/quote.example.json',
      message: expect.stringContaining('ref.Quote')
    })
  );
  expect(review.diagnostics).toContainEqual(
    expect.objectContaining({
      code: 'REFERENCE_SCHEMA_CHANGED',
      path: 'workflows/compute.workflow.json',
      message: expect.stringContaining('ref.Compute')
    })
  );
  expect(controller.current()).toEqual(before);
});

it.each(['source', 'resource', 'added file', 'removed file'])(
  'rejects reference acceptance after an unannounced %s change',
  async (kind) => {
    const { controller, adapter, transport } = await setup();
    await adapter.write('model/owned.rosetta', 'namespace owned\ntype Quote:\n amount number (1..1)\n', null);
    await adapter.writeBinary!('resources/codes.bin', new Uint8Array([255, 0, 1]), null);
    await controller.load();
    const cache = createMemoryReferenceCache();
    const review = await prepareProjectReferenceChange(controller, transport, cache, new AbortController().signal);
    const before = await adapter.read('build-config.lock.json');
    const path =
      kind === 'resource' ? 'resources/codes.bin' : kind === 'added file' ? 'model/new.rosetta' : 'model/owned.rosetta';
    const previous = await adapter.read(path);
    if (kind === 'removed file') await adapter.remove(path, previous!.revision);
    else if (kind === 'resource') await adapter.writeBinary!(path, new Uint8Array([255, 0, 2]), previous!.revision);
    else
      await adapter.write(path, 'namespace owned\ntype Changed:\n value string (1..1)\n', previous?.revision ?? null);
    await expect(review.accept(new AbortController().signal)).rejects.toThrow(/changed|conflict|review/i);
    expect(await adapter.read('build-config.lock.json')).toEqual(before);
  }
);

it('refreshes autosaved working-copy inputs before preparing reference compatibility', async () => {
  const { controller, adapter, transport } = await setup();
  await adapter.write('model/owned.rosetta', 'namespace owned\ntype Quote:\n amount number (1..1)\n', null);
  const stale = controller.current()!.revision;
  const review = await prepareProjectReferenceChange(
    controller,
    transport,
    createMemoryReferenceCache(),
    new AbortController().signal
  );
  expect(controller.current()!.revision).not.toBe(stale);
  const saved = await review.accept(new AbortController().signal);
  expect(saved.files.get('model/owned.rosetta')).toContain('Quote');
});

it('keeps raw binary input revisions when accepting an unchanged review', async () => {
  const { controller, adapter, transport } = await setup();
  const bytes = new Uint8Array([255, 128, 0, 17]);
  const revision = await adapter.writeBinary!('resources/codes.bin', bytes, null);
  const review = await prepareProjectReferenceChange(
    controller,
    transport,
    createMemoryReferenceCache(),
    new AbortController().signal
  );
  const saved = await review.accept(new AbortController().signal);
  expect(saved.fileRevisions.get('resources/codes.bin')).toBe(revision);
  expect((await adapter.read('resources/codes.bin'))?.revision).toBe(revision);
});

it('reviews newly autosaved invalid sources before allowing reference acceptance', async () => {
  const { controller, adapter, transport } = await setup();
  await adapter.write('model/invalid.rosetta', 'namespace owned\ntype Quote:\n amount MissingType (1..1)\n', null);
  const review = await prepareProjectReferenceChange(
    controller,
    transport,
    createMemoryReferenceCache(),
    new AbortController().signal
  );
  expect(review.diagnostics.some((issue) => issue.severity === 'error')).toBe(true);
  await expect(review.accept(new AbortController().signal)).rejects.toThrow();
  expect(await adapter.read('build-config.lock.json')).toBeUndefined();
});
