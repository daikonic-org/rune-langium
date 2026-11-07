// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { beforeAll, expect, it, vi } from 'vitest';
import { URI } from 'langium';
import { serializeRuneModel, isRosettaModel, isRosettaFunction, readLspModelMetadata } from '@rune-langium/core';
import { FunctionImplementationSchema, ImplementationSourcePackSchema } from '@rune-langium/core/project-contract';
import { createProjectSnapshot, createProjectDraftSnapshot, projectFileRevision } from '@rune-langium/project-config';
import { generate, resolveNativeImplementation } from '@rune-langium/codegen/export';
import { cdmRuneReferenceDocuments } from '../../../test/helpers/cdm-rune-implementations.js';
import { GENERATED_MODULE_TEST_TIMEOUT } from '../../../test/helpers/vitest-budget.js';
import { compileGeneratedTypeScript } from '../../codegen/test/helpers/compiled-typescript.js';
import { buildEffectiveProject } from '../src/effective-project.js';
import { projectReferenceUri } from '../src/project-uri.js';
import { publishCuratedImplementations } from '../src/curated-implementations/publication.js';
import {
  prepareCuratedImplementationSources,
  IMPLEMENTATION_SOURCE_PROVENANCE
} from '../src/curated-implementations/install.js';
import type { ReferenceDocument } from '../src/references/types.js';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const commit = '0f1f99aef829c23910476981bb91256544cb8569';
const files = new Map([
  ['rune-config.yml', 'model: {name: Curated implementations}\n'],
  ['build-config.yml', 'schemaVersion: 1\nsources: ["src/**/*.rosetta"]\n']
]);
let references: ReferenceDocument[];
beforeAll(async () => {
  const original = cdmRuneReferenceDocuments.map((reference) =>
    reference.uri === 'cdm/datetime.rosetta'
      ? {
          ...reference,
          content: reference.content + '\nfunc Today:\n [codeImplementation]\n output: today date (1..1)\n'
        }
      : reference
  );
  const graph = await buildEffectiveProject(await createProjectSnapshot('publisher', files, () => []), original);
  expect(graph.diagnostics).toEqual([]);
  references = await Promise.all(
    original.map(async (reference) => {
      const doc = graph.documents.find((doc) => doc.uri.path === URI.parse(projectReferenceUri(reference.uri)).path)!;
      const model = doc.parseResult.value;
      if (!isRosettaModel(model)) throw new Error('Expected model');
      const modelId = reference.uri.split('/')[0]!;
      return {
        ...reference,
        source: {
          model: modelId,
          repository: 'https://github.com/finos/common-domain-model',
          release: '7.9.0',
          commit
        },
        serialized: await publishCuratedImplementations(
          model,
          serializeRuneModel(graph.services.serializer.JsonSerializer, model),
          { model: modelId, commit }
        )
      };
    })
  );
});
const apply = async (
  snapshot: Awaited<ReturnType<typeof createProjectSnapshot>>,
  changes: ReadonlyMap<string, string | null>
) => createProjectDraftSnapshot(snapshot, changes, () => []);

it(
  'publishes an exclusive binding and copies Rune sources out of the bundle into an ordinary workspace',
  async () => {
    const snapshot = await createProjectSnapshot('installed', files, () => []);
    const prepared = await prepareCuratedImplementationSources(snapshot, references);
    expect(prepared.diagnostics).toEqual([]);
    expect([...prepared.changes.keys()].filter((path) => path.endsWith('.rosetta'))).toHaveLength(3);
    const installed = await apply(snapshot, prepared.changes);
    expect(installed.project.build.sources).toContain('model/implementations/**/*.rosetta');
    const graph = await buildEffectiveProject(installed, references);
    expect(graph.diagnostics).toEqual([]);
    const outputs = await generate([...graph.documents], {
      target: 'typescript',
      typescript: { layout: 'single-file' }
    });
    expect(outputs.flatMap((output) => output.diagnostics)).toEqual([]);
    const compiled = compileGeneratedTypeScript(outputs);
    for (const [name, expected] of [
      ['ClearExecution', true],
      ['ClearHistory', 0]
    ] as const) {
      const fn = outputs.flatMap((output) => output.funcs).find((fn) => fn.name === name)!;
      expect(compiled[fn.exportName!]!()).toBe(expected);
    }
    const today = graph.documents
      .flatMap((doc) =>
        isRosettaModel(doc.parseResult.value) ? doc.parseResult.value.elements.filter(isRosettaFunction) : []
      )
      .find((node) => node.name === 'Today')!;
    expect(resolveNativeImplementation(today, 'typescript')).toMatchObject({ status: 'available' });
    const fn = outputs.flatMap((output) => output.funcs).find((fn) => fn.name === 'Today')!;
    expect(String(compiled[fn.exportName!]!())).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await prepareCuratedImplementationSources(installed, references)).changes.size).toBe(0);
  },
  GENERATED_MODULE_TEST_TIMEOUT
);

it('preserves edited Rune files and never takes ownership of pre-existing user files', async () => {
  const snapshot = await createProjectSnapshot('edits', files, () => []);
  const initial = await prepareCuratedImplementationSources(snapshot, references);
  const path = 'model/implementations/cdm/event-common.rosetta';
  const installed = await apply(snapshot, initial.changes);
  const edited = await apply(installed, new Map([[path, installed.files.get(path)! + '\n// local edit\n']]));
  const refresh = await prepareCuratedImplementationSources(edited, references);
  expect(refresh.changes.has(path)).toBe(false);
  expect(refresh.diagnostics).toContainEqual(expect.objectContaining({ code: 'IMPLEMENTATION_SOURCE_EDITED', path }));
  const user = await apply(snapshot, new Map([[path, installed.files.get(path)!]]));
  const adopted = await apply(user, (await prepareCuratedImplementationSources(user, references)).changes);
  const removed = await prepareCuratedImplementationSources(adopted, []);
  expect(removed.changes.has(path)).toBe(false);
});

it('skips absent packs using canonical metadata and reads present packs from verified model JSON', async () => {
  const snapshot = await createProjectSnapshot('derived', files, () => []);
  const expected = await prepareCuratedImplementationSources(snapshot, references);
  const cached = references.map((reference) => ({
    ...reference,
    lsp: { metadata: readLspModelMetadata(reference.serialized!), compact: '' }
  }));
  const absent = new Set(
    cached
      .filter((reference) => !reference.lsp.metadata.hasImplementationSources)
      .map((reference) => reference.serialized)
  );
  const parse = JSON.parse;
  const spy = vi.spyOn(JSON, 'parse').mockImplementation((text, reviver) => {
    if (absent.has(text)) throw new Error('An absent pack caused its entire reference model to be parsed again.');
    return parse(text, reviver);
  });
  try {
    expect(await prepareCuratedImplementationSources(snapshot, cached)).toEqual(expected);
    await expect(
      prepareCuratedImplementationSources(
        snapshot,
        cached.map((reference) =>
          reference.lsp.metadata.hasImplementationSources
            ? { ...reference, source: { ...reference.source!, commit: 'a'.repeat(40) } }
            : reference
        )
      )
    ).rejects.toThrow(/provenance/);
  } finally {
    spy.mockRestore();
  }
});

it('removes only unchanged installed sources when their bundle is removed', async () => {
  const snapshot = await createProjectSnapshot('remove', files, () => []);
  const installed = await apply(snapshot, (await prepareCuratedImplementationSources(snapshot, references)).changes);
  const removed = await prepareCuratedImplementationSources(installed, []);
  expect([...removed.changes.values()].every((value) => value === null)).toBe(true);
  expect(removed.changes.get(IMPLEMENTATION_SOURCE_PROVENANCE)).toBeNull();
  expect([...removed.changes.keys()].filter((path) => path.endsWith('.rosetta'))).toHaveLength(3);
});

it('does not restore an explicitly deleted owned Rune source during refresh', async () => {
  const snapshot = await createProjectSnapshot('deleted', files, () => []);
  const installed = await apply(snapshot, (await prepareCuratedImplementationSources(snapshot, references)).changes);
  const path = 'model/implementations/cdm/event-common.rosetta';
  const deleted = await apply(installed, new Map([[path, null]]));
  const refreshed = await prepareCuratedImplementationSources(deleted, references);
  expect(refreshed.changes.has(path)).toBe(false);
  expect(refreshed.diagnostics).toContainEqual(expect.objectContaining({ code: 'IMPLEMENTATION_SOURCE_EDITED', path }));
});

it('rejects mixed kinds, unsafe source paths, corrupt source bytes and mismatched publication provenance', async () => {
  const snapshot = await createProjectSnapshot('invalid', files, () => []);
  const reference = references.find((reference) => reference.uri === 'cdm/datetime.rosetta')!;
  const root: unknown = JSON.parse(reference.serialized!);
  if (!root || typeof root !== 'object') throw new Error('Expected model');
  const pack = ImplementationSourcePackSchema.parse(Reflect.get(root, '$implementationSources'));
  const first = pack.files[0]!;
  const changed = (value: unknown) => [
    { ...reference, serialized: JSON.stringify({ ...root, $implementationSources: value }) }
  ];
  await expect(
    prepareCuratedImplementationSources(snapshot, changed({ ...pack, commit: 'a'.repeat(40) }))
  ).rejects.toThrow(/provenance/);
  await expect(
    prepareCuratedImplementationSources(
      snapshot,
      changed({ ...pack, files: [{ ...first, content: first.content + ' ' }] })
    )
  ).rejects.toThrow(/checksum/);
  await expect(
    prepareCuratedImplementationSources(
      snapshot,
      changed({ ...pack, files: [{ ...first, path: '../escape.rosetta' }] })
    )
  ).rejects.toThrow();
  expect(
    FunctionImplementationSchema.safeParse({
      kind: 'rune',
      namespace: 'example',
      name: 'Compute',
      signature: { inputs: [] },
      path: 'compute.rosetta',
      targets: { typescript: {} }
    }).success
  ).toBe(false);
  expect(
    FunctionImplementationSchema.safeParse({
      kind: 'language-specific',
      namespace: 'example',
      name: 'Compute',
      id: 'test',
      signature: { inputs: [] },
      targets: { typescript: undefined }
    }).success
  ).toBe(false);
  expect(await projectFileRevision(first.content)).toBe(first.sha256);
});

it(
  'installs bundle sources before a native named build and retains them as editable project inputs',
  async () => {
    const { createReferenceArtifacts } = await import('../../../test/helpers/project-reference-artifacts.js');
    const { cdmEventReference } = await import('../../../test/helpers/cdm-rune-implementations.js');
    const { resolveProjectReferences, createMemoryReferenceCache } = await import('../src/references/index.js');
    const { openLocalProject } = await import('../src/local-project.js');
    const { buildProject } = await import('../src/build-project.js');
    const fixture = await createReferenceArtifacts(
      undefined,
      undefined,
      { cdm: cdmEventReference },
      'https://mirror.example',
      true
    );
    const cache = createMemoryReferenceCache();
    const resolved = await resolveProjectReferences(
      fixture.snapshot,
      fixture.transport,
      new AbortController().signal,
      cache
    );
    expect(resolved.diagnostics).toEqual([]);
    const root = await mkdtemp(join(tmpdir(), 'rune-curated-install-'));
    try {
      const project = join(root, 'project');
      const inputs = new Map(fixture.snapshot.files);
      inputs.set('build-config.lock.json', JSON.stringify(resolved.lock));
      inputs.set(
        'build-config.yml',
        JSON.stringify({
          ...fixture.snapshot.project.build,
          targets: { typescript: { generator: 'typescript', options: { layout: 'single-file' }, output: 'generated' } }
        })
      );
      for (const [path, text] of inputs) {
        await mkdir(dirname(join(project, path)), { recursive: true });
        await writeFile(join(project, path), text);
      }
      const opened = await openLocalProject(project, { privateRoot: join(root, 'private') });
      const result = await buildProject(
        opened.snapshot,
        { targets: 'all', referenceTransport: fixture.transport, referenceCache: cache },
        opened.adapter
      );
      expect(result.diagnostics).toEqual([]);
      expect(result.status).toBe('success');
      const path = 'model/implementations/cdm/event-common.rosetta';
      const source = await readFile(join(project, path), 'utf8');
      expect(source).toContain('override namespace cdm.event.common');
      expect(result.outputs.some((path) => path.endsWith('.ts'))).toBe(true);
      await writeFile(join(project, path), source + '\n// local edit\n');
      const reopened = await openLocalProject(project, { privateRoot: join(root, 'private') });
      const again = await buildProject(
        reopened.snapshot,
        { targets: 'all', referenceTransport: fixture.transport, referenceCache: cache },
        reopened.adapter
      );
      expect(again.status).toBe('success');
      expect(again.diagnostics).toContainEqual(expect.objectContaining({ code: 'IMPLEMENTATION_SOURCE_EDITED' }));
      expect(await readFile(join(project, path), 'utf8')).toBe(source + '\n// local edit\n');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  GENERATED_MODULE_TEST_TIMEOUT
);
