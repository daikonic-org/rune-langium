// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { describe, it, expect, vi, afterEach } from 'vitest';
import { URI } from 'langium';
import { createRuneDslServices, isRosettaFunction, isData, type RosettaModel } from '@rune-langium/core';
import {
  prepareLocalDeclaration,
  localDeclarationError,
  type LocalDeclarationRequest
} from '../../src/services/local-declaration.js';

const { sourceLoader } = vi.hoisted(() => ({ sourceLoader: vi.fn() }));
vi.mock('../../src/services/workspace.js', async (original) => ({
  ...(await original<object>()),
  loadCuratedNamespaceSource: sourceLoader
}));
afterEach(() => vi.clearAllMocks());

async function fixture(sources: readonly string[]) {
  const { RuneDsl } = createRuneDslServices();
  const docs = sources.map((source, i) =>
    RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(source, URI.parse(`file:///[cdm]/f${i}.rosetta`))
  );
  await RuneDsl.shared.workspace.DocumentBuilder.build(docs);
  for (const doc of docs) expect(doc.parseResult.parserErrors).toEqual([]);
  const files = sources.map((content, i) => ({
    name: `f${i}.rosetta`,
    path: `[cdm]/f${i}.rosetta`,
    content,
    namespace: 'demo.source',
    dirty: false,
    readOnly: true,
    refOnly: true,
    sourceLoaded: true,
    bundleId: 'cdm',
    bundleVersion: 'pinned',
    artifactKey: 'immutable'
  }));
  const models = docs.map((doc, i) => ({ filePath: files[i]!.path, model: doc.parseResult.value as RosettaModel }));
  const request: LocalDeclarationRequest = {
    mode: 'modify',
    nodeId: 'demo.source.Compute#RosettaFunction',
    namespace: 'local.demo',
    name: 'Compute',
    files,
    models,
    projectReferenceDocuments: files.map((file) => ({
      uri: file.path.replace('[cdm]/', 'cdm/'),
      content: file.content
    }))
  };
  return { RuneDsl, docs, request };
}

describe('local declaration creation', () => {
  it('copies exact source with comments and dependencies, keeps the same-named type separate, and leaves curated files unchanged', async () => {
    const source = `namespace demo.source
import other.ns.* as other
annotation codeImplementation:
type Terms:
 value number (1..1)
type Compute:
 value string (1..1)
func Compute:
 [codeImplementation]
 inputs: terms Terms (1..1)
 output: result number (1..1)
 // retained implementation comment
 set result: terms -> value * 2
`;
    const { request, RuneDsl } = await fixture([source]);
    const before = JSON.stringify(request.files);
    const [copy] = await prepareLocalDeclaration(request);
    expect(copy).toMatchObject({ path: 'local/demo/Compute.rosetta', dirty: true });
    expect(copy!.readOnly).toBeUndefined();
    expect(copy!.refOnly).toBeUndefined();
    expect(copy!.content).toContain('import demo.source.*\nimport other.ns.* as other');
    expect(copy!.content).toContain(source.slice(source.indexOf('func Compute:')).trimEnd());
    expect(copy!.content).not.toContain('type Compute:');
    expect(JSON.stringify(request.files)).toBe(before);
    const local = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
      copy!.content,
      URI.parse('inmemory:///copy.rosetta')
    );
    await RuneDsl.shared.workspace.DocumentBuilder.build([local]);
    expect(local.parseResult.parserErrors).toEqual([]);
    const fn = local.parseResult.value.elements.find(isRosettaFunction)!;
    const terms = fn.inputs[0]!.typeCall.type.ref;
    expect(terms && isData(terms) && terms.name).toBe('Terms');
    expect(terms?.$container).toBe(request.models[0]!.model);
  });

  it('retains every dispatch variant and each source file’s imports', async () => {
    const { request } = await fixture([
      'namespace demo.source\nenum Kind:\n Cash\nfunc Compute:\n inputs: kind Kind (1..1)\n output: result number (1..1)\n',
      'namespace demo.source\nimport demo.dependency.*\nfunc Compute(kind: Kind -> Cash):\n set result: 42\n'
    ]);
    const [copy] = await prepareLocalDeclaration(request);
    expect(copy!.content).toContain('func Compute:');
    const copies = await prepareLocalDeclaration(request);
    expect(copies[1]!.content).toContain('func Compute(kind: Kind -> Cash):\n set result: 42');
    expect(copies[1]!.content).toContain('import demo.dependency.*');
    expect(copy!.content).not.toContain('import demo.dependency.*');
  });

  it.each([
    ['Data', 'type Derived extends demo.source.Base:'],
    ['Choice', 'type Derived extends demo.source.Base:'],
    ['RosettaEnumeration', 'enum Derived extends demo.source.Base:'],
    ['RosettaFunction', 'func Derived extends demo.source.Base:']
  ])('uses the shared renderer for %s inheritance', async (kind, expected) => {
    const [file] = await prepareLocalDeclaration({
      mode: 'extend',
      nodeId: `demo.source.Base#${kind}`,
      namespace: 'local.demo',
      name: 'Derived',
      files: [],
      models: []
    });
    expect(file!.content).toContain(expected);
    expect(sourceLoader).not.toHaveBeenCalled();
  });

  it('loads pinned source once for split dispatch declarations and rejects mismatched/missing source', async () => {
    const { request } = await fixture([
      'namespace demo.source\nfunc Compute:\n output: result number (1..1)\n',
      'namespace demo.source\nfunc Compute:\n output: result number (1..1)\n'
    ]);
    const documents = request.files.map((file, i) => ({ uri: `cdm/f${i}.rosetta`, content: file.content }));
    const cold = { ...request, files: request.files.map((file) => ({ ...file, content: '', sourceLoaded: false })) };
    sourceLoader.mockResolvedValue({ artifactKey: 'immutable', documents });
    expect(await prepareLocalDeclaration(cold)).toHaveLength(2);
    expect(sourceLoader).toHaveBeenCalledOnce();
    expect(sourceLoader).toHaveBeenCalledWith('cdm', 'pinned', 'demo.source', 'immutable');
    sourceLoader.mockResolvedValue({ artifactKey: 'different', documents });
    await expect(prepareLocalDeclaration(cold)).rejects.toThrow('Curated source changed');
    sourceLoader.mockResolvedValue({ artifactKey: 'immutable', documents: [] });
    await expect(prepareLocalDeclaration(cold)).rejects.toThrow('source document is missing');
    sourceLoader.mockResolvedValue({
      artifactKey: 'immutable',
      documents: documents.map((doc) => ({ ...doc, content: 'short' }))
    });
    await expect(prepareLocalDeclaration(cold)).rejects.toThrow('does not match');
  });

  it('rejects collisions, invalid names, curated namespaces and mutable source before writing anything', async () => {
    const { request } = await fixture(['namespace demo.source\nfunc Compute:\n']);
    expect(localDeclarationError({ ...request, namespace: 'demo.source' })).toMatch(/local namespace/);
    expect(localDeclarationError({ ...request, namespace: 'a..b' })).toMatch(/valid local namespace/);
    expect(localDeclarationError({ ...request, name: '../Escape' })).toMatch(/Invalid identifier/);
    expect(
      localDeclarationError({
        ...request,
        files: [
          ...request.files,
          { name: 'Compute.rosetta', path: 'local/demo/Compute.rosetta', content: 'user work', dirty: true }
        ]
      })
    ).toMatch(/already exists/);
    const [copy] = await prepareLocalDeclaration(request);
    expect(localDeclarationError({ ...request, files: [...request.files, copy!] })).toMatch(/already exists/);
    await expect(
      prepareLocalDeclaration({ ...request, files: request.files.map((file) => ({ ...file, artifactKey: undefined })) })
    ).rejects.toThrow('pinned curated source');
  });
});

async function projectForDeclaration() {
  const { referenceFixture } = await import('../../../../test/helpers/project-reference-fixture.js');
  const { resolveProjectReferences, createMemoryReferenceCache } =
    await import('@rune-langium/project-runtime/references');
  const { createProjectFileAdapter } = await import('../../src/workspace/project-file-adapter.js');
  const { createProjectController } = await import('../../src/workspace/project-controller.js');
  const { createOpfsRoot } = await import('../setup/opfs-mock.js');
  const { createProjectReceipt } = await import('@rune-langium/project-runtime/receipt');
  const reference = await referenceFixture();
  const lock = (
    await resolveProjectReferences(
      reference.snapshot,
      reference.transport,
      new AbortController().signal,
      createMemoryReferenceCache()
    )
  ).lock!;
  const adapter = createProjectFileAdapter({
    workspaceId: 'p',
    root: createOpfsRoot() as unknown as FileSystemDirectoryHandle,
    privateRoot: createOpfsRoot() as unknown as FileSystemDirectoryHandle,
    isWritable: () => true
  });
  for (const [path, text] of reference.snapshot.files) await adapter.write(path, text, null);
  await adapter.write('build-config.lock.json', JSON.stringify(lock), null);
  const controller = createProjectController({ workspaceId: 'p', adapter, validateTarget: () => [] });
  const snapshot = await controller.load();
  return { controller, adapter, receipt: await createProjectReceipt(snapshot) };
}
it('saves a copied dispatch family and its explicit provenance mapping once', async () => {
  const { request } = await fixture([
    'namespace demo.source\nenum Kind:\n Cash\nfunc Compute:\n inputs: kind Kind (1..1)\n output: result number (1..1)\n',
    'namespace demo.source\nimport demo.dependency.*\nfunc Compute(kind: Kind -> Cash):\n set result: 42\n'
  ]);
  const { controller, receipt } = await projectForDeclaration();
  const { modifyProjectDeclaration } = await import('../../src/services/local-declaration.js');
  const saved = await modifyProjectDeclaration({ ...request, projectReceipt: receipt }, controller);
  expect(saved.project.build.overrides).toHaveLength(1);
  expect(saved.project.build.overrides![0]).toMatchObject({
    kind: 'declaration',
    source: { model: 'cdm', name: 'Compute', kind: 'RosettaFunction' },
    replacement: { model: 'local', namespace: 'local.demo' },
    provenance: { uri: 'cdm/f0.rosetta', commit: saved.lock!.references.cdm!.commit }
  });
  const copies = [...saved.files].filter(([path]) => path.endsWith('.rosetta'));
  expect(copies).toHaveLength(2);
  expect(copies.every(([path]) => path.startsWith('model/'))).toBe(true);
  expect(copies.some(([, text]) => text.includes('set result: 42'))).toBe(true);
  const { createProjectReceipt } = await import('@rune-langium/project-runtime/receipt');
  const repeated = await modifyProjectDeclaration(
    { ...request, projectReceipt: await createProjectReceipt(saved) },
    controller
  );
  expect(repeated).toBe(saved);
  expect([...repeated.files].filter(([path]) => path.endsWith('.rosetta'))).toHaveLength(2);
});
it('saves an extension without redirecting curated callers', async () => {
  const { request } = await fixture(['namespace demo.source\nfunc Compute:\n output: result number (1..1)']);
  const { controller, receipt } = await projectForDeclaration();
  const { modifyProjectDeclaration } = await import('../../src/services/local-declaration.js');
  const saved = await modifyProjectDeclaration(
    { ...request, mode: 'extend', name: 'Derived', projectReceipt: receipt },
    controller
  );
  expect(saved.project.build.overrides ?? []).toEqual([]);
  expect([...saved.files.values()].some((text) => text.includes('func Derived extends demo.source.Compute:'))).toBe(
    true
  );
});
it('rejects a stale project receipt before a declaration copy Save', async () => {
  const { request } = await fixture(['namespace demo.source\nfunc Compute:\n output: result number (1..1)']);
  const { controller, receipt } = await projectForDeclaration();
  const before = controller.current();
  const { modifyProjectDeclaration } = await import('../../src/services/local-declaration.js');
  await expect(
    modifyProjectDeclaration({ ...request, projectReceipt: { ...receipt, overridesDigest: 'stale' } }, controller)
  ).rejects.toThrow(/ready|changed|stale/);
  expect(controller.current()).toBe(before);
});
it('refuses to stamp locked provenance on a copy loaded from another curated cohort', async () => {
  const { request } = await fixture([
    'namespace demo.source\nfunc Compute:\n output: result number (1..1)\n set result: 1'
  ]);
  const { controller, receipt } = await projectForDeclaration();
  const before = controller.current();
  const { modifyProjectDeclaration } = await import('../../src/services/local-declaration.js');
  await expect(
    modifyProjectDeclaration(
      {
        ...request,
        projectReceipt: receipt,
        projectReferenceDocuments: [
          { uri: 'cdm/f0.rosetta', content: request.files[0]!.content.replace('set result: 1', 'set result: 2') }
        ]
      },
      controller
    )
  ).rejects.toThrow(/locked reference release/);
  expect(controller.current()).toBe(before);
});
it('copies verified locked source without requiring legacy namespace-artifact metadata', async () => {
  const { request } = await fixture([
    'namespace demo.source\nfunc Compute:\n output: result number (1..1)\n set result: 1'
  ]);
  const { controller, receipt } = await projectForDeclaration();
  const { modifyProjectDeclaration } = await import('../../src/services/local-declaration.js');
  const files = request.files.map(({ bundleVersion: _bundleVersion, artifactKey: _artifactKey, ...file }) => file);
  const saved = await modifyProjectDeclaration({ ...request, files, projectReceipt: receipt }, controller);
  expect(saved.project.build.overrides).toHaveLength(1);
  expect(sourceLoader).not.toHaveBeenCalled();
});
it('recognizes one declaration document under parser and editor path aliases on repeated Modify', async () => {
  const { request } = await fixture([
    'namespace demo.source\nfunc Compute:\n output: result number (1..1)\n set result: 1'
  ]);
  request.models = [...request.models, { ...request.models[0]!, filePath: 'cdm/f0.rosetta' }];
  const { controller, receipt } = await projectForDeclaration();
  const { modifyProjectDeclaration } = await import('../../src/services/local-declaration.js');
  const saved = await modifyProjectDeclaration({ ...request, projectReceipt: receipt }, controller);
  expect(saved.project.build.overrides).toHaveLength(1);
  expect([...saved.files.keys()].filter((path) => path.includes('Compute') && path.endsWith('.rosetta'))).toHaveLength(
    1
  );
});
it('records the exact selected source URI when two locked documents have identical source bytes', async () => {
  const { request } = await fixture([
    'namespace demo.source\nfunc Compute:\n output: result number (1..1)\n set result: 1'
  ]);
  request.projectReferenceDocuments = [
    { uri: 'cdm/another.rosetta', content: request.files[0]!.content },
    ...request.projectReferenceDocuments!
  ];
  const { controller, receipt } = await projectForDeclaration();
  const { modifyProjectDeclaration } = await import('../../src/services/local-declaration.js');
  const saved = await modifyProjectDeclaration({ ...request, projectReceipt: receipt }, controller);
  expect(saved.project.build.overrides![0]!.provenance?.uri).toBe('cdm/f0.rosetta');
});
