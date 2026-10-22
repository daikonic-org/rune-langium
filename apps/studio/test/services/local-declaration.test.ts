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
    models
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
