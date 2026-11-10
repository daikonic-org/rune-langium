// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { AstUtils, DocumentState, URI, type AstNode, type LangiumDocument, type Reference } from 'langium';
import type { RosettaModel } from '../generated/ast.js';
import { getSharedServices } from './shared-services.js';

/** Whether linked reference access is available on a published AST. */
export function hasComputedScopes(node: AstNode): boolean {
  const document = AstUtils.findRootNode(node).$document;
  return document !== undefined && document.state >= DocumentState.ComputedScopes;
}

/** Read restored targets directly; resolve lazy references only after their document scopes exist. */
export function getLinkedReferenceTarget<T extends AstNode>(owner: AstNode, reference: Reference<T>): T | undefined {
  if (!hasComputedScopes(owner)) {
    const property = Object.getOwnPropertyDescriptor(reference, 'ref');
    if (!property || !('value' in property)) return undefined;
  }
  return reference.ref;
}

/**
 * Result of parsing a Rosetta DSL source string.
 *
 * @remarks
 * Even when `hasErrors` is `false`, the returned `value` is always a valid
 * (possibly partial) `RosettaModel`. Callers should check `hasErrors` before
 * relying on cross-reference resolution — unresolved references in the AST
 * will have `ref === undefined`.
 *
 * @pitfalls
 * - Do NOT mutate fields on the returned `value` — Langium's incremental
 *   reparser tracks AST identity; mutating nodes bypasses indexing and causes
 *   stale cross-references on the next build.
 * - `LangiumDocument` objects obtained via lower-level APIs must not be cached
 *   across workspace changes — cross-references become stale after
 *   `DocumentBuilder.update()` invalidates the index.
 *
 * @category Core
 */
export interface ParseResult {
  /** The root AST node. */
  value: RosettaModel;
  /** Lexer errors encountered during parsing. */
  lexerErrors: Array<{
    message: string;
    offset: number;
    line?: number | undefined;
    column?: number | undefined;
  }>;
  /** Parser errors encountered during parsing. */
  parserErrors: Array<{
    message: string;
    offset?: number | undefined;
    line?: number | undefined;
    column?: number | undefined;
  }>;
  /** Whether the parse completed without errors. */
  hasErrors: boolean;
}

/**
 * Parse a Rosetta DSL source string into a typed AST.
 *
 * @remarks
 * Services are lazily initialized on first call and reused across subsequent
 * calls. The services singleton is module-level — concurrent calls to `parse()`
 * in tests that re-import the module may share state unexpectedly. Use
 * `createRuneDslServices()` directly in long-running servers.
 *
 * @useWhen
 * - Validating a single `.rosetta` file or snippet in memory
 * - Building a parse pipeline in a Node.js script
 * - Unit-testing grammar rules in isolation
 *
 * @avoidWhen
 * - Parsing files that have cross-references to other documents — unresolved
 *   references will have `ref === undefined`. Use `parseWorkspace()` instead.
 * - Running inside a Langium LSP server — the DocumentBuilder is already
 *   managed by the server lifecycle; calling `parse()` creates a second
 *   services instance and wastes memory.
 *
 * @pitfalls
 * - Do NOT call `parse()` on a file whose type references live in other
 *   `.rosetta` files — cross-file references will be unresolved (undefined).
 *   Provide all documents to `parseWorkspace()` for resolved cross-references.
 * - Do NOT mutate nodes in the returned `value` — Langium's index tracks AST
 *   node identity; mutations bypass incremental reparse and corrupt the scope graph.
 *
 * @param input - The Rosetta DSL source text.
 * @param uri   - Optional URI for the document (defaults to `inmemory:///model.rosetta`).
 * @returns A {@link ParseResult} with the root `RosettaModel` node and any errors.
 *
 * @example
 * ```ts
 * import { parse } from '@rune-langium/core';
 *
 * const result = await parse(`
 *   namespace com.example
 *   version "1.0.0"
 *
 *   type Trade:
 *     quantity number (1..1)
 * `);
 *
 * if (result.hasErrors) {
 *   console.error(result.lexerErrors, result.parserErrors);
 * } else {
 *   console.log(result.value.elements.length, 'elements');
 * }
 * ```
 *
 * @category Core
 */
export async function parse(input: string, uri?: string): Promise<ParseResult> {
  const { RuneDsl } = getSharedServices();
  const documentUri = URI.parse(uri ?? 'inmemory:///model.rosetta');
  const document: LangiumDocument<RosettaModel> = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
    input,
    documentUri
  );

  await RuneDsl.shared.workspace.DocumentBuilder.build([document]);

  const model = document.parseResult.value;
  const lexerErrors = document.parseResult.lexerErrors.map((e) => ({
    message: e.message,
    offset: e.offset,
    line: e.line,
    column: e.column
  }));
  const parserErrors = document.parseResult.parserErrors.map((e) => ({
    message: e.message,
    offset: e.token?.startOffset,
    line: e.token?.startLine,
    column: e.token?.startColumn
  }));

  return {
    value: model,
    lexerErrors,
    parserErrors,
    hasErrors: lexerErrors.length > 0 || parserErrors.length > 0
  };
}

/**
 * Parse multiple Rosetta DSL source strings as a workspace.
 * Cross-references between documents will be resolved after all documents are built.
 *
 * @remarks
 * `DocumentBuilder.build()` indexes all provided documents together, so
 * cross-file `type` references (e.g., a `Data` type extending a type defined in
 * another file) will resolve correctly. Documents not included in `entries` will
 * produce unresolved references even if they exist on disk.
 *
 * @useWhen
 * - Generating code from a set of related `.rosetta` files
 * - Validating a full namespace bundle where types reference each other
 * - Running integration tests that span multiple Rosetta files
 *
 * @avoidWhen
 * - Parsing a single self-contained file — use the simpler `parse()` instead
 * - Processing very large CDM workspaces incrementally — prefer the LSP server
 *   for streaming document updates
 *
 * @pitfalls
 * - All documents must be provided in a **single** `parseWorkspace()` call for
 *   cross-references to resolve. Documents added across separate calls will NOT
 *   see each other's types.
 * - Do NOT reuse the `ParseResult.value` nodes after calling `parseWorkspace()`
 *   again with a different set — the underlying index is rebuilt and prior AST
 *   node identity becomes invalid.
 * - Workspace indexing runs synchronously after `build()` completes; very large
 *   workspaces (e.g., full CDM) may block for several seconds in a single-threaded
 *   environment.
 *
 * @param entries - Array of `{ uri, content }` objects to parse together.
 *   Each `uri` must be unique; duplicate URIs cause the later entry to overwrite
 *   the earlier one silently.
 * @returns An array of {@link ParseResult} objects in the same order as `entries`.
 *
 * @example
 * ```ts
 * import { parseWorkspace } from '@rune-langium/core';
 *
 * const results = await parseWorkspace([
 *   { uri: 'file:///models/base.rosetta',  content: baseSource },
 *   { uri: 'file:///models/trade.rosetta', content: tradeSource },
 * ]);
 *
 * const tradeModel = results[1].value;
 * // Type references in tradeModel now resolve into baseModel's types
 * ```
 *
 * @category Core
 */
export async function parseWorkspace(entries: Array<{ uri: string; content: string }>): Promise<ParseResult[]> {
  const { RuneDsl } = getSharedServices();
  const factory = RuneDsl.shared.workspace.LangiumDocumentFactory;
  const builder = RuneDsl.shared.workspace.DocumentBuilder;

  const documents = entries.map((entry) => factory.fromString(entry.content, URI.parse(entry.uri)));

  await builder.build(documents);

  return documents.map((doc) => {
    const model = doc.parseResult.value as RosettaModel;
    const lexErrors = doc.parseResult.lexerErrors.map((e) => ({
      message: e.message,
      offset: e.offset,
      line: e.line,
      column: e.column
    }));
    const parsErrors = doc.parseResult.parserErrors.map((e) => ({
      message: e.message,
      offset: e.token?.startOffset,
      line: e.token?.startLine,
      column: e.token?.startColumn
    }));
    return {
      value: model,
      lexerErrors: lexErrors,
      parserErrors: parsErrors,
      hasErrors: lexErrors.length > 0 || parsErrors.length > 0
    };
  });
}
