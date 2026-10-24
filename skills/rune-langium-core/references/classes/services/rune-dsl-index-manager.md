# Classes

## services

### `RuneDslIndexManager`
Extended IndexManager that supports external registration of exported
symbols without requiring a full document build. Used for deferred
deserialization of curated model artifacts (ADR 007 Phase 4).
*extends `DefaultIndexManager`*
```ts
constructor(services: LangiumSharedCoreServices): RuneDslIndexManager
```
**Properties:**
- `serviceRegistry: ServiceRegistry`
- `documents: LangiumDocuments`
- `astReflection: AstReflection`
- `symbolIndex: Map<string, AstNodeDescription[]>` — The symbol index stores all `AstNodeDescription` items exported by a document.
The key used in this map is the string representation of the specific document URI.
- `symbolByTypeIndex: ContextCache<string, string, AstNodeDescription[], string>` — This is a cache for the `allElements()` method.
It caches the descriptions from `symbolIndex` grouped by types.
- `referenceIndex: Map<string, ReferenceDescription[]>` — This index keeps track of all `ReferenceDescription` items exported by a document.
This is used to compute which elements are affected by a document change
and for finding references to an AST node.
**Methods:**
- `registerExports(uri: URI, descriptions: AstNodeDescription[]): void` — Register exported symbol descriptions for a document URI without
requiring the document to be parsed or built. The descriptions are
added directly to the symbol index, making them discoverable via
`allElements()` and cross-reference resolution.

Call `clearExports(uri)` or `remove(uri)` before re-registering
to avoid duplicates.
- `clearExports(uri: URI): void` — Clear previously registered exports for a document URI.
- `findAllReferences(targetNode: AstNode, astNodePath: string): Stream<ReferenceDescription>` — Returns all known references that are pointing to the given `targetNode`.
- `allElements(nodeType?: string, uris?: Set<string>): Stream<AstNodeDescription>` — Compute a list of all exported elements, optionally filtered using a type identifier and document URIs.
- `getFileDescriptions(uri: string, nodeType?: string): AstNodeDescription[]`
- `remove(uri: URI): void` — Remove the specified document URI from the index.
Necessary when documents are deleted and not referenceable anymore.
- `removeContent(uri: URI): void` — Remove only the information about the exportable content of a document.
- `removeReferences(uri: URI): void` — Remove only the information about the cross-references of a document.
- `updateContent(document: LangiumDocument, cancelToken?: CancellationToken): Promise<void>` — Update the information about the exportable content of a document inside the index.
- `updateReferences(document: LangiumDocument, cancelToken?: CancellationToken): Promise<void>` — Update the information about the cross-references of a document inside the index.
- `isAffected(document: LangiumDocument, changedUris: Set<string>): boolean` — Determine whether the given document could be affected by changes of the documents
identified by the given URIs (second parameter). The document is typically regarded as
affected if it contains a reference to any of the changed files.
