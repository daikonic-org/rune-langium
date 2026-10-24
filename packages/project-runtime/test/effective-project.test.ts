// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { it, expect } from 'vitest';
import { createProjectSnapshot, type ProjectOverride } from '@rune-langium/project-config';
import { AstUtils } from 'langium';
import { isRosettaSymbolReference, isRosettaFunction, isData } from '@rune-langium/core';
import { buildEffectiveProject } from '../src/effective-project.js';
const identity = (model: string, namespace: string, kind: string, name: string) => ({ model, namespace, kind, name });
const mapping: ProjectOverride = {
  kind: 'declaration',
  source: identity('cdm', 'ref', 'RosettaFunction', 'Compute'),
  replacement: identity('local', 'custom', 'RosettaFunction', 'Compute')
};
async function fixture(
  overrides: ProjectOverride[] = [mapping],
  replacement = 'func Compute:\n inputs: amount number (1..1)\n output: result number (1..1)\n set result: amount + 2'
) {
  const snapshot = await createProjectSnapshot(
    'p',
    new Map([
      ['rune-config.yml', 'model: {name: Demo}'],
      ['build-config.yml', JSON.stringify({ schemaVersion: 1, overrides })],
      ['model/custom.rosetta', 'namespace custom\n' + replacement]
    ]),
    () => []
  );
  return {
    snapshot,
    documents: [
      {
        uri: 'cdm/functions.rosetta',
        content:
          'namespace ref\nfunc Compute:\n inputs: amount number (1..1)\n output: result number (1..1)\n set result: amount + 1\nfunc Caller:\n inputs: amount number (1..1)\n output: result number (1..1)\n set result: Compute(amount)'
      }
    ]
  };
}
it('redirects a curated caller to the exact local function in one fresh graph', async () => {
  const { snapshot, documents } = await fixture();
  const before = JSON.stringify(documents);
  const graph = await buildEffectiveProject(snapshot, documents);
  expect(graph.diagnostics).toEqual([]);
  const functions = graph.documents.flatMap((doc) =>
    AstUtils.streamAllContents(doc.parseResult.value).filter(isRosettaFunction).toArray()
  );
  const replacement = functions.find((fn) => fn.$container.name === 'custom')!;
  const caller = functions.find((fn) => fn.name === 'Caller')!;
  const calls = AstUtils.streamAllContents(caller).filter(isRosettaSymbolReference).toArray();
  expect(calls.find((call) => call.symbol.$refText === 'Compute')!.symbol.ref).toBe(replacement);
  expect(JSON.stringify(documents)).toBe(before);
  expect(graph.receipt.revision).toBe(snapshot.revision);
});
it('redirects a copied self-reference locally and keeps source artifacts immutable', async () => {
  const { snapshot, documents } = await fixture(
    [
      {
        kind: 'declaration',
        source: identity('cdm', 'ref', 'Data', 'Node'),
        replacement: identity('local', 'custom', 'Data', 'Node')
      }
    ],
    'import ref.Node\ntype Node:\n next ref.Node (0..1)'
  );
  documents[0]!.content = 'namespace ref\ntype Node:\n next Node (0..1)';
  const graph = await buildEffectiveProject(snapshot, documents);
  expect(graph.diagnostics).toEqual([]);
  const local = graph.documents
    .flatMap((doc) => AstUtils.streamAllContents(doc.parseResult.value).filter(isData).toArray())
    .find((node) => node.$container.name === 'custom')!;
  expect(local.attributes[0]!.typeCall.type.ref).toBe(local);
});
it.each([
  ['missing destination', [mapping], 'func Different:\n output: result number (1..1)', 'OVERRIDE_DESTINATION'],
  [
    'incompatible signature',
    [mapping],
    'func Compute:\n inputs: amount string (1..1)\n output: result number (1..1)',
    'OVERRIDE_SIGNATURE'
  ],
  [
    'mapping cycle',
    [mapping, { ...mapping, source: mapping.replacement, replacement: mapping.source }],
    undefined,
    'OVERRIDE_CYCLE'
  ]
] as const)('rejects %s without falling back to originals', async (_name, overrides, replacement, code) => {
  const { snapshot, documents } = await fixture([...overrides], replacement);
  const graph = await buildEffectiveProject(snapshot, documents);
  expect(graph.diagnostics.some((issue) => issue.code === code)).toBe(true);
});

it('relinks serialized curated callers and leaves their cached generation unchanged', async () => {
  const { snapshot, documents } = await fixture();
  const upstream = await buildEffectiveProject(
    { ...snapshot, project: { ...snapshot.project, build: { ...snapshot.project.build, overrides: [] } } },
    documents
  );
  expect(upstream.diagnostics).toEqual([]);
  const { serializeRuneModel } = await import('@rune-langium/core');
  const serialized = upstream.documents
    .filter((doc) => doc.uri.toString().includes('[cdm]') || doc.uri.toString().includes('%5Bcdm%5D'))
    .map((doc) => ({
      uri: 'cdm/functions.rosetta',
      content: documents[0]!.content,
      serialized: serializeRuneModel(upstream.services.serializer.JsonSerializer, doc.parseResult.value)
    }));
  expect(serialized).toHaveLength(1);
  const bytes = JSON.stringify(serialized);
  const originalCaller = upstream.documents
    .flatMap((doc) => AstUtils.streamAllContents(doc.parseResult.value).filter(isRosettaFunction).toArray())
    .find((fn) => fn.name === 'Caller')!;
  const originalCall = AstUtils.streamAllContents(originalCaller)
    .filter(isRosettaSymbolReference)
    .find((call) => call.symbol.$refText === 'Compute')!;
  const originalTarget = originalCall.symbol.ref;
  const effective = await buildEffectiveProject(snapshot, serialized);
  expect(effective.diagnostics).toEqual([]);
  const functions = effective.documents.flatMap((doc) =>
    AstUtils.streamAllContents(doc.parseResult.value).filter(isRosettaFunction).toArray()
  );
  const local = functions.find((fn) => fn.$container.name === 'custom')!;
  const caller = functions.find((fn) => fn.name === 'Caller')!;
  expect(
    AstUtils.streamAllContents(caller)
      .filter(isRosettaSymbolReference)
      .find((call) => call.symbol.$refText === 'Compute')!.symbol.ref
  ).toBe(local);
  expect(originalCall.symbol.ref).toBe(originalTarget);
  expect(JSON.stringify(serialized)).toBe(bytes);
});
it('retains and redirects a complete dispatch family and rejects a dropped variant', async () => {
  const base = 'func Compute:\n inputs: kind Kind (1..1)\n output: result number (1..1)\n set result: 1\n';
  const variant = 'func Compute(kind: Kind -> Cash):\n set result: 2';
  const { snapshot, documents } = await fixture([mapping], 'import ref.Kind\n' + base + variant);
  documents[0]!.content =
    'namespace ref\nenum Kind:\n Cash\n' +
    base +
    variant +
    '\nfunc Caller:\n inputs: kind Kind (1..1)\n output: result number (1..1)\n set result: Compute(kind)';
  const graph = await buildEffectiveProject(snapshot, documents);
  expect(graph.diagnostics).toEqual([]);
  const functions = graph.documents.flatMap((doc) =>
    AstUtils.streamAllContents(doc.parseResult.value).filter(isRosettaFunction).toArray()
  );
  const local = functions.filter((fn) => fn.$container.name === 'custom');
  expect(local).toHaveLength(2);
  expect(local.find((fn) => fn.dispatchAttribute)!.dispatchAttribute!.ref).toBe(
    local.find((fn) => !fn.dispatchAttribute)!.inputs[0]
  );
  const caller = functions.find((fn) => fn.name === 'Caller')!;
  expect(
    AstUtils.streamAllContents(caller)
      .filter(isRosettaSymbolReference)
      .find((call) => call.symbol.$refText === 'Compute')!.symbol.ref
  ).toBe(local.find((fn) => !fn.dispatchAttribute));
  const files = new Map(snapshot.files);
  files.set('model/custom.rosetta', 'namespace custom\nimport ref.Kind\n' + base);
  const invalid = await buildEffectiveProject(await createProjectSnapshot('p', files, () => []), documents);
  expect(invalid.diagnostics.some((issue) => issue.code === 'OVERRIDE_DISPATCH')).toBe(true);
  const dispatch = JSON.stringify(['kind', 'Kind', 'Cash']);
  const partialMapping = {
    ...mapping,
    source: { ...mapping.source, dispatch },
    replacement: { ...mapping.replacement, dispatch }
  };
  const partial = await fixture([partialMapping], 'import ref.Kind\n' + base + variant);
  const incomplete = await buildEffectiveProject(partial.snapshot, documents);
  expect(incomplete.diagnostics.some((issue) => issue.code === 'OVERRIDE_DISPATCH')).toBe(true);
});

it('relinks a serialized member by its effective scope after a structural replacement reorders fields', async () => {
  const { snapshot, documents } = await fixture(
    [
      {
        kind: 'declaration',
        source: identity('cdm', 'ref', 'Data', 'Account'),
        replacement: identity('local', 'custom', 'Data', 'Account')
      }
    ],
    'type Account:\n name string (1..1)\n identifier string (1..1)'
  );
  documents[0]!.content =
    'namespace ref\ntype Account:\n identifier string (1..1)\n name string (1..1)\nfunc Read:\n inputs: account Account (1..1)\n output: result string (1..1)\n set result: account -> identifier';
  const original = await buildEffectiveProject(
    { ...snapshot, project: { ...snapshot.project, build: { ...snapshot.project.build, overrides: [] } } },
    documents
  );
  expect(original.diagnostics).toEqual([]);
  const { serializeRuneModel, isRosettaFeatureCall } = await import('@rune-langium/core');
  const serialized = original.documents
    .filter((doc) => doc.uri.path.includes('/[cdm]/'))
    .map((doc) => ({
      ...documents[0]!,
      serialized: serializeRuneModel(original.services.serializer.JsonSerializer, doc.parseResult.value)
    }));
  expect(serialized).toHaveLength(1);
  const effective = await buildEffectiveProject(snapshot, serialized);
  expect(effective.diagnostics).toEqual([]);
  const local = effective.documents
    .flatMap((doc) => AstUtils.streamAllContents(doc.parseResult.value).filter(isData).toArray())
    .find((node) => node.$container.name === 'custom')!;
  const feature = effective.documents.flatMap((doc) =>
    AstUtils.streamAllContents(doc.parseResult.value).filter(isRosettaFeatureCall).toArray()
  )[0]!;
  expect(feature.feature.ref).toBe(local.attributes[1]);
  const files = new Map(snapshot.files);
  files.set('model/custom.rosetta', 'namespace custom\ntype Account:\n name string (1..1)');
  const broken = await buildEffectiveProject(await createProjectSnapshot('p', files, () => []), serialized);
  expect(broken.diagnostics.some((issue) => issue.code === 'PROJECT_LINK')).toBe(true);
});

it.each(['number(digits: 4) (1..1)', 'number (0..1)'])(
  'rejects incompatible callable constraints: %s',
  async (parameter) => {
    const { snapshot, documents } = await fixture(
      [mapping],
      'func Compute:\n inputs: amount ' + parameter + '\n output: result number (1..1)\n set result: 1'
    );
    const graph = await buildEffectiveProject(snapshot, documents);
    expect(graph.diagnostics.some((issue) => issue.code === 'OVERRIDE_SIGNATURE')).toBe(true);
  }
);

it('selects effective roots consistently for exports, preview schemas and Python bindings', async () => {
  const { snapshot, documents } = await fixture();
  const graph = await buildEffectiveProject(snapshot, documents);
  expect(graph.diagnostics).toEqual([]);
  const { resolveExportSelection, generatePreviewSchemas, generatePythonModule } =
    await import('@rune-langium/codegen/export');
  const originalRoots = graph.documents.map((document) => document.parseResult.value);
  const selected = resolveExportSelection([...graph.documents], {
    namespaces: [],
    declarations: [{ namespace: 'ref', kind: 'RosettaFunction', name: 'Compute' }]
  });
  expect(selected.unknown).toEqual([]);
  expect(selected.explicit).toEqual([{ namespace: 'custom', kind: 'RosettaFunction', name: 'Compute' }]);
  const targets = generatePreviewSchemas([...graph.documents]).map((schema) => schema.targetId);
  expect(targets).toContain('custom.Compute');
  expect(targets).toContain('ref.Caller');
  expect(targets).not.toContain('ref.Compute');
  const python = generatePythonModule(graph.documents);
  expect(python.bindings.has('custom.Compute')).toBe(true);
  expect(python.bindings.has('ref.Compute')).toBe(false);
  expect(graph.documents.map((document) => document.parseResult.value)).toEqual(originalRoots);
});
