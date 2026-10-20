// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { AstUtils, DefaultDocumentBuilder, DocumentState, URI, isMultiReference } from 'langium';
import type { AstNode, LangiumDocument } from 'langium';
import type { CancellationToken } from 'vscode-languageserver';
import type { LangiumServices, LangiumSharedServices } from 'langium/lsp';
import {
  hydrateModelDocument,
  isRosettaModel,
  compactLspModelJson,
  serializeRuneModel,
  type LspModelUpdate
} from '@rune-langium/core';

/** Dependencies reuse the language's real scoping/linking, without source parsing. */
export class RuneModelIndex {
  private readonly capturedSources = new WeakMap<LangiumDocument, AstNode>();
  private dirty = false;
  private readonly models = new Map<string, { document: LangiumDocument; modelJson: string }>();
  constructor(
    private readonly shared: LangiumSharedServices,
    private readonly services: LangiumServices,
    private readonly persist?: (update: LspModelUpdate) => Promise<void>
  ) {}

  async sync(update: LspModelUpdate): Promise<void> {
    const { LangiumDocuments, DocumentBuilder } = this.shared.workspace;
    if (update.document) {
      const { modelJson } = update.document;
      const uri = URI.parse(update.document.uri).toString();
      const { model, document } = hydrateModelDocument(
        { RuneDsl: this.services, shared: this.shared },
        uri,
        modelJson,
        { register: 'none' }
      );
      if (!isRosettaModel(model)) throw new Error('Expected a serialized RosettaModel');
      // Serialized refs point at a past generation. Build real lazy Langium refs
      // so live edits, additions and removals invalidate the same index as source.
      for (const node of AstUtils.streamAst(model)) {
        for (const info of AstUtils.streamReferences(node)) {
          const reference = isMultiReference(info.reference)
            ? this.services.references.Linker.buildMultiReference(
                info.container,
                info.property,
                undefined,
                info.reference.$refText
              )
            : this.services.references.Linker.buildReference(
                info.container,
                info.property,
                undefined,
                info.reference.$refText
              );
          const container = info.container as unknown as Record<string, unknown>;
          if (info.index === undefined) container[info.property] = reference;
          else (container[info.property] as unknown[])[info.index] = reference;
        }
      }
      this.models.set(uri, { document, modelJson });
      this.dirty = true;
    }
    if (!update.retain) return;
    const retain = new Set(update.retain.map((uri) => URI.parse(uri).toString()));
    const removed = [...this.models.keys()].filter((uri) => !retain.has(uri));
    for (const uri of removed) this.models.delete(uri);
    if (!this.dirty && removed.length === 0) return;
    if (removed.length)
      await DocumentBuilder.update(
        [],
        removed.filter((uri) => !this.shared.workspace.TextDocuments?.get(uri)).map((uri) => URI.parse(uri))
      );
    for (const [uri, { document }] of this.models) {
      const current = LangiumDocuments.getDocument(URI.parse(uri));
      // The open editor owns its URI; semantic snapshots never replace live text.
      if (this.shared.workspace.TextDocuments?.get(uri)) continue;
      if (current !== document) {
        LangiumDocuments.deleteDocument(document.uri);
        LangiumDocuments.addDocument(document);
      }
    }
    await this.rebuild();
    this.dirty = false;
  }

  async captureSources(
    documents: LangiumDocument[],
    persist?: (update: LspModelUpdate) => Promise<void>
  ): Promise<void> {
    for (const document of documents) {
      const uri = document.uri.toString();
      const model = document.parseResult.value;
      if (!this.models.has(uri) || !model.$cstNode || this.capturedSources.get(document) === model) continue;
      if (document.parseResult.parserErrors.length || document.parseResult.lexerErrors.length) continue;
      const modelJson = compactLspModelJson(serializeRuneModel(this.services.serializer.JsonSerializer, model));
      const update = { document: { uri, modelJson } };
      await this.sync(update);
      await persist?.(update);
      this.capturedSources.set(document, model);
    }
  }

  async restore(uris: URI[]): Promise<void> {
    const { LangiumDocuments } = this.shared.workspace;
    let restored = false;
    for (const uri of uris) {
      let snapshot = this.models.get(uri.toString());
      if (!snapshot || LangiumDocuments.hasDocument(uri)) continue;
      // didOpen can parse in-place over a snapshot; detach even if a rapid
      // close cancelled validation before the normal source-capture hook.
      if (snapshot.document.parseResult.value.$cstNode) {
        await this.captureSources([snapshot.document], this.persist);
        snapshot = this.models.get(uri.toString())!;
        // Invalid source may have been parsed in-place over the indexed snapshot.
        // Rehydrate its saved valid JSON rather than retaining the partial AST.
        if (snapshot.document.parseResult.value.$cstNode) {
          await this.sync({ document: { uri: uri.toString(), modelJson: snapshot.modelJson } });
          snapshot = this.models.get(uri.toString())!;
        }
      }
      const model = snapshot.document;
      // A previously registered snapshot may have been invalidated by deletion.
      this.services.references.Linker.unlink(model);
      model.state = DocumentState.Parsed;
      LangiumDocuments.addDocument(model);
      restored = true;
    }
    if (restored) await this.rebuild();
  }

  private async rebuild(): Promise<void> {
    const { DocumentBuilder, LangiumDocuments } = this.shared.workspace;
    const documents = LangiumDocuments.all.toArray();
    for (const document of documents) {
      if (document.state >= DocumentState.ComputedScopes) {
        DocumentBuilder.resetToState(document, DocumentState.IndexedContent);
      }
    }
    await DocumentBuilder.build(documents, { validation: true });
  }
}

/** Snapshot dependencies have no CST; diagnostics belong to live source only. */
export class RuneLspDocumentBuilder extends DefaultDocumentBuilder {
  restoreModels?: (uris: URI[]) => Promise<void>;
  // Dependency snapshots need exports/scopes, not an eager walk of every body.
  // Live source still links and indexes references for diagnostics/invalidation.
  protected override shouldLink(document: LangiumDocument): boolean {
    return Boolean(document.parseResult.value.$cstNode) && super.shouldLink(document);
  }
  protected override shouldValidate(document: LangiumDocument): boolean {
    return Boolean(document.parseResult.value.$cstNode) && super.shouldValidate(document);
  }
  override async update(changed: URI[], deleted: URI[], token?: CancellationToken): Promise<void> {
    // Lazy dependency references are not in Langium's reverse-reference index.
    // Invalidate their cached targets and rebuild the actual open source set.
    const sources = new Map(changed.map((uri) => [uri.toString(), uri]));
    if (changed.length || deleted.length) {
      const removed = new Set(deleted.map((uri) => uri.toString()));
      for (const document of this.langiumDocuments.all) {
        if (!document.parseResult.value.$cstNode) {
          this.serviceRegistry.getServices(document.uri).references.Linker.unlink(document);
        } else {
          const uri = document.uri.toString();
          if (!removed.has(uri) && this.textDocuments?.get(uri)) sources.set(uri, document.uri);
        }
      }
    }
    await super.update([...sources.values()], deleted, token);
    await this.restoreModels?.(deleted);
  }
}
