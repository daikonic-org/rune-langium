// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, it, expect, vi } from 'vitest';
import {
  createRuneDslServices,
  type RuneDslIndexManager,
  type RuneDslLinker,
  type DeferredModelProvider,
  type Data,
  type RosettaModel
} from '../../src/index.js';
import { URI, EmptyFileSystem } from 'langium';
import type { AstNode, AstNodeDescription } from 'langium';

/**
 * Register a corpus document as a deferred stub — mirrors what the parser worker does
 * for curated CDM files (ADR 007 Phase 4).
 *
 * The document is parsed to obtain the AST model but never built into the IndexManager
 * via the normal `DocumentBuilder.build()` path.  Instead, lightweight stubs (no `node`
 * reference) are registered directly so the scope provider can locate the corpus types,
 * while the actual materialization is deferred to `RuneDslLinker.loadAstNode`.
 *
 * Omitting `node` from stubs is the critical invariant: if `node` were present,
 * `DefaultLinker.loadAstNode` would return it immediately, bypassing the deferred path.
 */
function registerDeferredCorpus(
  services: ReturnType<typeof createRuneDslServices>,
  uri: string,
  content: string,
  stubs: Array<{ type: string; name: string; path: string }>,
  deferredModels: Map<string, AstNode>
): void {
  const factory = services.RuneDsl.shared.workspace.LangiumDocumentFactory;
  const indexManager = services.RuneDsl.shared.workspace.IndexManager as RuneDslIndexManager;
  const parsedUri = URI.parse(uri);

  // Parse to get the in-memory model — do NOT build or add to LangiumDocuments
  const doc = factory.fromString(content, parsedUri);
  // Use the normalized form as the map key — URI.parse().toString() may alter the scheme
  // (e.g. `inmemory:///foo` → `inmemory:/foo`), so loadAstNode's uri.toString() lookup must match.
  deferredModels.set(parsedUri.toString(), doc.parseResult.value);

  // Register stubs without `node` so loadAstNode must call deferredProvider.getModel
  const descriptions: AstNodeDescription[] = stubs.map((s) => ({
    type: s.type,
    name: s.name,
    path: s.path,
    documentUri: parsedUri
  }));
  indexManager.registerExports(parsedUri, descriptions);
}

describe('RuneDslLinker — deferred corpus materialization (ADR 007)', () => {
  it('reuses a document registered by a batch materializer instead of registering its root twice', () => {
    const models = new Map<string, AstNode>();
    const provider: DeferredModelProvider = {
      getModel(uri) {
        const model = models.get(uri)!;
        const document = services.shared.workspace.LangiumDocumentFactory.fromModel(model, URI.parse(uri));
        services.shared.workspace.LangiumDocuments.addDocument(document);
        return model;
      },
      consume: (uri) => {
        models.delete(uri);
      }
    };
    const services = createRuneDslServices(EmptyFileSystem, provider);
    const uri = 'file:///batch.rosetta';
    registerDeferredCorpus(services, uri, 'namespace batch\ntype Party:', [], models);
    const root = models.get(uri) as RosettaModel;
    const target = (services.RuneDsl.references.Linker as RuneDslLinker).loadAstNode({
      name: 'Party',
      type: 'Data',
      path: '/elements@0',
      documentUri: URI.parse(uri)
    });
    expect(target).toBe(root.elements[0]);
    expect(services.shared.workspace.LangiumDocuments.getDocument(URI.parse(uri))?.parseResult.value).toBe(root);
    expect(models.size).toBe(0);
  });
  it('calls getModel during eagerLinking, not at parse time', async () => {
    const deferredModels = new Map<string, AstNode>();
    const getModel = vi.fn((uri: string) => deferredModels.get(uri));
    const consume = vi.fn((uri: string) => deferredModels.delete(uri));
    const provider: DeferredModelProvider = { getModel, consume };

    const services = createRuneDslServices(EmptyFileSystem, provider);
    const corpusUri = 'inmemory:///corpus/party.rosetta';
    // Langium normalizes the URI on round-trip (inmemory:/// → inmemory:/)
    const normalizedCorpusUri = URI.parse(corpusUri).toString();

    registerDeferredCorpus(
      services,
      corpusUri,
      `namespace test.linker
       type Party:
         name string (1..1)`,
      [{ type: 'Data', name: 'Party', path: '/elements/0' }],
      deferredModels
    );

    // getModel must not have been called during registration
    expect(getModel).not.toHaveBeenCalled();

    const { RuneDsl } = services;
    const factory = RuneDsl.shared.workspace.LangiumDocumentFactory;
    const builder = RuneDsl.shared.workspace.DocumentBuilder;
    const langiumDocs = RuneDsl.shared.workspace.LangiumDocuments;

    const userDoc = factory.fromString(
      `namespace test.linker
       type Trade:
         seller Party (1..1)`,
      URI.parse('inmemory:///user/trade.rosetta')
    );
    langiumDocs.addDocument(userDoc);
    await builder.build([userDoc], { validation: false, eagerLinking: true });

    // Called exactly once — during the link phase
    expect(getModel).toHaveBeenCalledTimes(1);
    expect(getModel).toHaveBeenCalledWith(normalizedCorpusUri);
    expect(consume).toHaveBeenCalledTimes(1);
    expect(consume).toHaveBeenCalledWith(normalizedCorpusUri);

    // Cross-reference resolved to the corpus Party node
    const trade = (userDoc.parseResult.value as RosettaModel).elements[0] as Data;
    expect(trade.attributes[0]?.typeCall?.type?.ref?.name).toBe('Party');

    // Corpus doc now present in LangiumDocuments for subsequent cross-refs
    expect(langiumDocs.hasDocument(URI.parse(corpusUri))).toBe(true);
  });

  it('does not call getModel on a second build for the same URI', async () => {
    const deferredModels = new Map<string, AstNode>();
    const getModel = vi.fn((uri: string) => deferredModels.get(uri));
    const consume = vi.fn((uri: string) => deferredModels.delete(uri));
    const provider: DeferredModelProvider = { getModel, consume };

    const services = createRuneDslServices(EmptyFileSystem, provider);
    const corpusUri = 'inmemory:///corpus/party.rosetta';

    registerDeferredCorpus(
      services,
      corpusUri,
      `namespace test.linker
       type Party:
         name string (1..1)`,
      [{ type: 'Data', name: 'Party', path: '/elements/0' }],
      deferredModels
    );

    const { RuneDsl } = services;
    const factory = RuneDsl.shared.workspace.LangiumDocumentFactory;
    const builder = RuneDsl.shared.workspace.DocumentBuilder;
    const langiumDocs = RuneDsl.shared.workspace.LangiumDocuments;

    const userDoc = factory.fromString(
      `namespace test.linker
       type Trade:
         seller Party (1..1)`,
      URI.parse('inmemory:///user/trade.rosetta')
    );
    langiumDocs.addDocument(userDoc);

    // First build — materializes from deferred
    await builder.build([userDoc], { validation: false, eagerLinking: true });
    expect(getModel).toHaveBeenCalledTimes(1);

    // Second build — corpus doc is in LangiumDocuments; getModel must not fire again
    await builder.build([userDoc], { validation: false, eagerLinking: true });
    expect(getModel).toHaveBeenCalledTimes(1);
  });

  it('materializes each corpus document exactly once for cross-refs across two separate corpus files', async () => {
    const deferredModels = new Map<string, AstNode>();
    const getModel = vi.fn((uri: string) => deferredModels.get(uri));
    const consume = vi.fn((uri: string) => deferredModels.delete(uri));
    const provider: DeferredModelProvider = { getModel, consume };

    const services = createRuneDslServices(EmptyFileSystem, provider);
    const partyUri = 'inmemory:///corpus/party.rosetta';
    const currencyUri = 'inmemory:///corpus/currency.rosetta';

    registerDeferredCorpus(
      services,
      partyUri,
      `namespace test.linker
       type Party:
         name string (1..1)`,
      [{ type: 'Data', name: 'Party', path: '/elements/0' }],
      deferredModels
    );
    registerDeferredCorpus(
      services,
      currencyUri,
      `namespace test.linker
       enum Currency:
         USD
         EUR`,
      [{ type: 'RosettaEnumeration', name: 'Currency', path: '/elements/0' }],
      deferredModels
    );

    const { RuneDsl } = services;
    const factory = RuneDsl.shared.workspace.LangiumDocumentFactory;
    const builder = RuneDsl.shared.workspace.DocumentBuilder;
    const langiumDocs = RuneDsl.shared.workspace.LangiumDocuments;

    const userDoc = factory.fromString(
      `namespace test.linker
       type Trade:
         seller Party (1..1)
         currency Currency (1..1)`,
      URI.parse('inmemory:///user/trade.rosetta')
    );
    langiumDocs.addDocument(userDoc);
    await builder.build([userDoc], { validation: false, eagerLinking: true });

    // One materialization per corpus file — the registry has both entries cleared
    expect(getModel).toHaveBeenCalledTimes(2);
    expect(consume).toHaveBeenCalledTimes(2);
    expect(deferredModels.size).toBe(0);

    const trade = (userDoc.parseResult.value as RosettaModel).elements[0] as Data;
    expect(trade.attributes[0]?.typeCall?.type?.ref?.name).toBe('Party');
    expect(trade.attributes[1]?.typeCall?.type?.ref?.name).toBe('Currency');
  });

  it('behaves identically to DefaultLinker when no deferredProvider is supplied', async () => {
    const services = createRuneDslServices(EmptyFileSystem);
    const { RuneDsl } = services;
    const factory = RuneDsl.shared.workspace.LangiumDocumentFactory;
    const builder = RuneDsl.shared.workspace.DocumentBuilder;
    const langiumDocs = RuneDsl.shared.workspace.LangiumDocuments;

    const userDoc = factory.fromString(
      `namespace test.linker
       type Trade:
         seller Party (1..1)`,
      URI.parse('inmemory:///user/trade.rosetta')
    );
    langiumDocs.addDocument(userDoc);

    // No corpus stub in index — cross-ref cannot resolve, but must not throw
    await expect(builder.build([userDoc], { validation: false, eagerLinking: true })).resolves.not.toThrow();

    const trade = (userDoc.parseResult.value as RosettaModel).elements[0] as Data;
    // Unresolvable cross-ref: ref is undefined
    expect(trade.attributes[0]?.typeCall?.type?.ref).toBeUndefined();
  });
});
