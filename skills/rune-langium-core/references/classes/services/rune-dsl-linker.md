# Classes

## services

### `RuneDslLinker`
Langium linker that lazily materializes corpus documents stored in a
`DeferredModelProvider` the first time a cross-reference to them is resolved.

Without a `deferredProvider` this behaves identically to `DefaultLinker`.
*extends `DefaultLinker`*
```ts
constructor(services: LangiumCoreServices, deferredProvider?: DeferredModelProvider): RuneDslLinker
```
**Properties:**
- `reflection: AstReflection`
- `scopeProvider: ScopeProvider`
- `astNodeLocator: AstNodeLocator`
- `langiumDocuments: () => LangiumDocuments`
- `profiler: LangiumProfiler | undefined`
- `languageId: string`
- `referenceResolver: ReferenceResolver`
**Methods:**
- `loadAstNode(nodeDescription: AstNodeDescription): AstNode | undefined` — Resolve a description through the same deferred-document path used by linking.
- `link(document: LangiumDocument, cancelToken?: CancellationToken): Promise<void>` — Links all cross-references within the specified document. The default implementation loads only target
elements from documents that are present in the `LangiumDocuments` service. The linked references are
stored in the document's `references` property.
- `doLink(refInfo: ReferenceInfo, document: LangiumDocument): void`
- `unlink(document: LangiumDocument): void` — Unlinks all references within the specified document and removes them from the list of `references`.
- `getCandidate(refInfo: ReferenceInfo): AstNodeDescription | LinkingError` — Determines a candidate AST node description for linking the given reference.
- `getCandidates(refInfo: ReferenceInfo): LinkingError | AstNodeDescription[]` — Determines a candidate AST node description for linking the given reference.
- `buildReference(node: AstNode, property: string, refNode: CstNode | undefined, refText: string): Reference` — Creates a cross reference node being aware of its containing AstNode, the corresponding CstNode,
the cross reference text denoting the target AstNode being already extracted of the document text,
as well as the unique cross reference identifier.

Default behavior:
 - The returned Reference's 'ref' property pointing to the target AstNode is populated lazily on its
   first visit.
 - If the target AstNode cannot be resolved on the first visit, an error indicator will be installed
   and further resolution attempts will *not* be performed.
- `buildMultiReference(node: AstNode, property: string, refNode: CstNode | undefined, refText: string): MultiReference`
- `resolveReference(reference: DefaultReference, node: AstNode, property: string): AstNode | undefined`
- `resolveMultiReference(reference: DefaultMultiReference, node: AstNode, property: string): MultiReferenceItem<AstNode>[]`
- `throwCyclicReferenceError(node: AstNode, property: string, refText: string): never`
- `getLinkedNode(refInfo: ReferenceInfo): { node?: AstNode; descr?: AstNodeDescription; error?: LinkingError }`
- `createLinkingError(refInfo: ReferenceInfo, targetDescription?: AstNodeDescription): LinkingError`
