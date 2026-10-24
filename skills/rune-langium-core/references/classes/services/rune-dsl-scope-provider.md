# Classes

## services

### `RuneDslScopeProvider`
Custom scope provider for the Rune DSL.

Handles the 21 cross-reference patterns from the original Xtext implementation:
- Cases 1-3: Feature calls (-&gt; and -&gt;&gt;)
- Cases 4-8: Operation assign root, segments, constructor keys
- Case 9-11: Switch case guards, enum values
- Case 12: Symbol references (most complex — context-dependent)
- Cases 13-21: Annotation paths, external refs, etc.
*extends `DefaultScopeProvider`*
```ts
constructor(services: LangiumCoreServices): RuneDslScopeProvider
```
**Properties:**
- `reflection: AstReflection`
- `nameProvider: NameProvider`
- `descriptions: AstNodeDescriptionProvider`
- `indexManager: IndexManager`
- `globalScopeCache: WorkspaceCache<string, Scope>`
**Methods:**
- `getScope(context: ReferenceInfo): Scope`
- `getGlobalScope(referenceType: string, context: ReferenceInfo): Scope` — Override global scope lookup to support `import ... as &lt;alias&gt;` resolution.

When a file contains `import fpml.consolidated.shared.* as fpml`, references
written as `fpml.Leg` should resolve to `fpml.consolidated.shared.Leg` in the
global index.  We do this by building a thin alias-expansion layer on top of
the regular global scope: for every qualified reference name we try to replace
a known alias prefix with the full namespace prefix and retry the lookup.
- `createScope(elements: Iterable<AstNodeDescription>, outerScope?: Scope, options?: ScopeOptions): Scope` — Create a scope for the given collection of AST node descriptions.
- `createScopeForNodes(elements: Iterable<AstNode>, outerScope?: Scope, options?: ScopeOptions): Scope` — Create a scope for the given collection of AST nodes, which need to be transformed into respective
descriptions first. This is done using the `NameProvider` and `AstNodeDescriptionProvider` services.
