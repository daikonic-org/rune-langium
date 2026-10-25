# Classes

## services

### `RuneStoreHydrator`
Hydrator variant for the Rune store substrate.

Differences from DefaultHydrator:
 - CST nodes are dropped entirely — the store has no use for parse-tree data.
   (`$cstNode`, `$containerIndex`, and `$containerProperty` are deleted from
   the output so the runtime object matches the `Dehydrated&lt;T&gt;` type, which
   excludes all Langium runtime fields.)
 - `$cstText` (a custom field stamped by `preserveCstText` BEFORE dehydration)
   is preserved — the visual editor's expression cells read it after the
   round-trip, and DefaultHydrator would otherwise drop it as a `$`-field.
 - References are stored as `{ $refText: string }` only — the editable `Dehydrated&lt;T&gt;` wire format.
 - Re-hydration rebuilds a proper `Reference` via `this.linker.buildReference`, passing
   `undefined` for the CST node (consistent with the drop above).
 - $namespace is stamped from the enclosing RosettaModel before $container is stripped.
*extends `DefaultHydrator`*
```ts
constructor(services: LangiumCoreServices): RuneStoreHydrator
```
**Properties:**
- `grammar: Grammar`
- `lexer: Lexer`
- `linker: Linker`
- `grammarElementIdMap: BiMap<AbstractElement, number>`
- `tokenTypeIdMap: BiMap<number, TokenType>`
- `cstNodeBuilder: CstNodeBuilder` — Used to assemble the CST during hydration; `CstNodeBuilder` is not a service, so we keep a local instance.
**Methods:**
- `dehydrateNode<T>(node: T): Dehydrated<T>` — Dehydrate a single AST node to its Dehydrated&lt;T&gt; wire form.
- `createDehyrationContext(node: AstNode): DehydrateContext` — CST nodes never survive dehydration here (see class doc), so skip the
base class's full CST-tree walk when building the context — on large
corpora that walk dominates dehydration cost for zero benefit.
- `dehydrateAstNode(node: AstNode, context: DehydrateContext): object`
- `dehydrateCstNode(_node: CstNode, _context: DehydrateContext): Record<string, never>`
- `dehydrateReference(reference: Reference, _context: DehydrateContext): { $refText: string }`
- `hydrateReference(reference: { $refText: string }, node: AstNode, name: string, _context: HydrateContext): Reference`
- `dehydrate(result: ParseResult<AstNode>): ParseResult<object>` — Converts a parse result to a plain object. The resulting object can be sent across worker threads.
- `dehydrateLexerReport(lexerReport: LexingReport): LexingReport`
- `hydrate<T>(result: ParseResult<object>): ParseResult<T>` — Converts a plain object to a parse result. The included AST node can then be used in the main thread.
Calling this method on objects that have not been dehydrated first will result in undefined behavior.
- `createHydrationContext(node: any): HydrateContext`
- `hydrateAstNode(node: any, context: HydrateContext): AstNode`
- `setParent(node: any, parent: any): any`
- `hydrateCstNode(cstNode: any, context: HydrateContext, num?: number): CstNode`
- `hydrateCstLeafNode(cstNode: any): LeafCstNode`
- `getTokenType(name: string): TokenType`
- `getGrammarElementId(node: AbstractElement | undefined): number | undefined`
- `getGrammarElement(id: number): AbstractElement | undefined`
- `createGrammarElementIdMap(): void`
