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
