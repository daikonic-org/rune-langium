// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { redirectProjectNode } from '../references/project-resolution.js';
import { DefaultLinker } from 'langium';
import type { AstNode, AstNodeDescription, LangiumCoreServices, LangiumDocumentFactory } from 'langium';

/**
 * Contract for on-demand corpus document materialization (ADR 007).
 *
 * The `RuneDslLinker` calls `getModel` when Langium encounters a cross-reference
 * to a corpus document that has not yet been deserialized. The implementation in
 * the parser worker reads raw JSON from the `deferredModelJson` map and calls
 * `JsonSerializer.deserialize` at that moment.
 *
 * `consume` is called immediately after so the worker can drop the JSON string
 * and avoid double-deserialization on subsequent linking passes.
 */
export interface DeferredModelProvider {
  getModel(uri: string): AstNode | undefined;
  consume(uri: string): void;
}

/**
 * Langium linker that lazily materializes corpus documents stored in a
 * `DeferredModelProvider` the first time a cross-reference to them is resolved.
 *
 * Without a `deferredProvider` this behaves identically to `DefaultLinker`.
 */
export class RuneDslLinker extends DefaultLinker {
  private readonly deferredProvider: DeferredModelProvider | undefined;
  private readonly services: LangiumCoreServices;
  private readonly factory: LangiumDocumentFactory;

  constructor(services: LangiumCoreServices, deferredProvider?: DeferredModelProvider) {
    super(services);
    this.services = services;
    this.deferredProvider = deferredProvider;
    this.factory = services.shared.workspace.LangiumDocumentFactory;
  }

  /** Resolve a description through the same deferred-document path used by linking. */
  override loadAstNode(nodeDescription: AstNodeDescription): AstNode | undefined {
    if (nodeDescription.node) return redirectProjectNode(this.services, nodeDescription.node);

    const uri = nodeDescription.documentUri;
    const langiumDocs = this.langiumDocuments();
    let doc = langiumDocs.getDocument(uri);

    if (!doc && this.deferredProvider) {
      const model = this.deferredProvider.getModel(uri.toString());
      if (model !== undefined) {
        doc = this.factory.fromModel(model, uri);
        langiumDocs.addDocument(doc);
        this.deferredProvider.consume(uri.toString());
      }
    }

    if (!doc) return undefined;
    const node = this.astNodeLocator.getAstNode(doc.parseResult.value, nodeDescription.path);
    return node ? redirectProjectNode(this.services, node) : undefined;
  }
}
