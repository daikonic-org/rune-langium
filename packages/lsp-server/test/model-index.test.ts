// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { describe, it, expect, vi } from 'vitest';
import { EmptyFileSystem, URI, DocumentState } from 'langium';
import { createRuneDslServices, compactLspModelJson, serializeRuneModel } from '@rune-langium/core';
import { createRuneLspServer } from '../src/rune-dsl-server.js';

const depUri = 'file:///workspace/dependency.rosetta';
const userUri = 'file:///workspace/user.rosetta';
async function modelJson(text: string) {
  const { RuneDsl, shared } = createRuneDslServices(EmptyFileSystem);
  const document = shared.workspace.LangiumDocumentFactory.fromString(text, URI.parse(depUri));
  shared.workspace.LangiumDocuments.addDocument(document);
  await shared.workspace.DocumentBuilder.build([document], { validation: false });
  return compactLspModelJson(serializeRuneModel(RuneDsl.serializer.JsonSerializer, document.parseResult.value));
}
async function fixture() {
  const lsp = createRuneLspServer();
  await lsp.shared.workspace.WorkspaceManager.initialized({});
  const json = await modelJson('namespace example\n\ntype Party: <"A counterparty">\n name string (1..1)\n');
  await lsp.syncModels({ document: { uri: depUri, modelJson: json } });
  await lsp.syncModels({ retain: [depUri] });
  const user = lsp.shared.workspace.LangiumDocumentFactory.fromString(
    'namespace example\n\ntype Trade:\n party Party (1..1)\n',
    URI.parse(userUri)
  );
  lsp.shared.workspace.LangiumDocuments.addDocument(user);
  await lsp.shared.workspace.DocumentBuilder.build([user], { validation: true });
  return { lsp, user };
}

describe('semantic LSP dependency index', () => {
  it('indexes dependency scopes without eagerly linking every serialized body', async () => {
    const lsp = createRuneLspServer();
    await lsp.shared.workspace.WorkspaceManager.initialized({});
    const json = await modelJson('namespace example\ntype Party:\n name string (1..1)\n');
    const link = vi.spyOn(lsp.services.references.Linker, 'link');
    await lsp.syncModels({ document: { uri: depUri, modelJson: json } });
    await lsp.syncModels({ retain: [depUri] });
    expect(link.mock.calls.some(([document]) => document.uri.toString() === depUri)).toBe(false);
    const document = lsp.shared.workspace.LangiumDocuments.getDocument(URI.parse(depUri))!;
    expect(document.state).toBe(DocumentState.ComputedScopes);
    expect(document.localSymbols).toBeDefined();
  });

  it('resolves cross-file names and returns the serialized declaration range', async () => {
    const { lsp, user } = await fixture();
    expect(user.diagnostics?.filter((d) => d.severity === 1)).toEqual([]);
    const definitions = await lsp.services.lsp.DefinitionProvider!.getDefinition(user, {
      textDocument: { uri: userUri },
      position: { line: 3, character: 9 }
    });
    expect(definitions).toMatchObject([
      {
        targetUri: depUri,
        targetSelectionRange: {
          start: { line: 2, character: 5 },
          end: { line: 2, character: 10 }
        }
      }
    ]);
    const dependency = lsp.shared.workspace.LangiumDocuments.getDocument(URI.parse(depUri))!;
    expect(dependency.parseResult.value.$cstNode).toBeUndefined();
    expect(dependency.diagnostics).toBeUndefined();
  });

  it('invalidates cached references when a dependency changes or disappears', async () => {
    const { lsp, user } = await fixture();
    const json = await modelJson('namespace example\n\ntype Renamed:\n name string (1..1)\n');
    await lsp.syncModels({ document: { uri: depUri, modelJson: json } });
    await lsp.syncModels({ retain: [depUri] });
    expect(user.diagnostics?.some((d) => d.message.includes("'Party'"))).toBe(true);
    await lsp.syncModels({ retain: [] });
    expect(lsp.shared.workspace.LangiumDocuments.hasDocument(URI.parse(depUri))).toBe(false);
  });

  it('restores a dependency snapshot after closing its live editor document', async () => {
    const { lsp, user } = await fixture();
    await lsp.shared.workspace.DocumentBuilder.update([], [URI.parse(depUri)]);
    expect(lsp.shared.workspace.LangiumDocuments.hasDocument(URI.parse(depUri))).toBe(true);
    expect(user.state).toBe(DocumentState.Validated);
    expect(user.diagnostics?.filter((d) => d.severity === 1)).toEqual([]);
  });
});

it('acknowledges project redirects only after a fresh semantic graph applies them', async () => {
  const lsp = createRuneLspServer();
  await lsp.shared.workspace.WorkspaceManager.initialized({});
  const replacementUri = 'file:///workspace/local.rosetta';
  const original = await modelJson(
    'namespace upstream\nfunc Compute:\n inputs: amount number (1..1)\n output: result number (1..1)\n set result: amount + 1\nfunc Caller:\n inputs: amount number (1..1)\n output: result number (1..1)\n set result: Compute(amount)'
  );
  const local = await modelJson(
    'namespace custom\nfunc Compute:\n inputs: amount number (1..1)\n output: result number (1..1)\n set result: amount + 2'
  );
  await lsp.syncModels({ document: { uri: depUri, modelJson: original } });
  await lsp.syncModels({ document: { uri: replacementUri, modelJson: local } });
  const { createProjectSnapshot } = await import('../../project-config/src/index.js');
  const { createProjectResolutionContext } = await import('@rune-langium/project-runtime/context');
  const overrides = [
    {
      kind: 'declaration',
      source: { model: 'cdm', namespace: 'upstream', kind: 'RosettaFunction', name: 'Compute' },
      replacement: { model: 'local', namespace: 'custom', kind: 'RosettaFunction', name: 'Compute' }
    }
  ];
  const snapshot = await createProjectSnapshot(
    'p',
    new Map([
      ['rune-config.yml', 'model: {name: Demo}'],
      ['build-config.yml', JSON.stringify({ schemaVersion: 1, overrides })]
    ]),
    () => []
  );
  const resolution = await createProjectResolutionContext(snapshot, { [depUri]: 'cdm', [replacementUri]: 'local' });
  const receipt = resolution.receipt;
  const applied = await lsp.syncModels({ retain: [depUri, replacementUri], resolution });
  expect(applied).toEqual(receipt);
  const { AstUtils } = await import('langium');
  const { isRosettaFunction, isRosettaSymbolReference } = await import('@rune-langium/core');
  const root = lsp.shared.workspace.LangiumDocuments.getDocument(URI.parse(depUri))!.parseResult.value;
  const caller = AstUtils.streamAllContents(root)
    .filter(isRosettaFunction)
    .find((node) => node.name === 'Caller')!;
  const call = AstUtils.streamAllContents(caller)
    .filter(isRosettaSymbolReference)
    .find((node) => node.symbol.$refText === 'Compute')!;
  const target = lsp.shared.workspace.LangiumDocuments.getDocument(URI.parse(replacementUri))!.parseResult.value;
  expect(call.symbol.ref).toBe(AstUtils.streamAllContents(target).filter(isRosettaFunction).head());
  const previous = root;
  await lsp.syncModels({ retain: [depUri, replacementUri], resolution: null });
  const restored = lsp.shared.workspace.LangiumDocuments.getDocument(URI.parse(depUri))!.parseResult.value;
  expect(restored).not.toBe(previous);
  const restoredCaller = AstUtils.streamAllContents(restored)
    .filter(isRosettaFunction)
    .find((node) => node.name === 'Caller')!;
  expect(
    AstUtils.streamAllContents(restoredCaller)
      .filter(isRosettaSymbolReference)
      .find((node) => node.symbol.$refText === 'Compute')!.symbol.ref?.$container
  ).toBe(restored);
  expect(call.symbol.ref).toBe(AstUtils.streamAllContents(target).filter(isRosettaFunction).head());
  await expect(lsp.syncModels({ retain: [depUri], resolution })).rejects.toThrow(/destination/i);
  await expect(
    lsp.syncModels({
      retain: [depUri],
      resolution: { ...resolution, receipt: { ...receipt, overridesDigest: 'f'.repeat(64) } }
    })
  ).rejects.toThrow(/digest|receipt/i);
});

it('keeps dependency snapshots relinkable when a project context is cleared', async () => {
  const lsp = createRuneLspServer();
  await lsp.shared.workspace.WorkspaceManager.initialized({});
  await lsp.syncModels({ document: { uri: depUri, modelJson: await modelJson('namespace upstream\ntype Thing:') } });
  await lsp.syncModels({
    document: {
      uri: userUri,
      modelJson: await modelJson('namespace consumers\ntype Use:\n value upstream.Thing (1..1)')
    }
  });
  const { createProjectSnapshot } = await import('../../project-config/src/index.js');
  const { createProjectResolutionContext } = await import('@rune-langium/project-runtime/context');
  const snapshot = await createProjectSnapshot('p', new Map([['rune-config.yml', 'model: {name: Demo}']]), () => []);
  const resolution = await createProjectResolutionContext(snapshot, { [depUri]: 'cdm', [userUri]: 'local' });
  await lsp.syncModels({ retain: [depUri, userUri], resolution });
  await lsp.syncModels({ retain: [depUri, userUri], resolution: null });
  const { isData, isRosettaModel } = await import('@rune-langium/core');
  const dependency = lsp.shared.workspace.LangiumDocuments.getDocument(URI.parse(depUri))!.parseResult.value;
  const consumer = lsp.shared.workspace.LangiumDocuments.getDocument(URI.parse(userUri))!.parseResult.value;
  if (!isRosettaModel(dependency) || !isRosettaModel(consumer) || !isData(consumer.elements[0]))
    throw new Error('Expected source fixtures');
  expect(consumer.elements[0].attributes[0]!.typeCall.type.ref).toBe(dependency.elements[0]);
});
