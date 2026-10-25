# services

| Class | Description |
|-------|-------------|
| [RuneDslIndexManager](rune-dsl-index-manager.md) | Extended IndexManager that supports external registration of exported
symbols without requiring a full document build. Used for deferred
deserialization of curated model artifacts (ADR 007 Phase 4). |
| [RuneDslLinker](rune-dsl-linker.md) | Langium linker that lazily materializes corpus documents stored in a
`DeferredModelProvider` the first time a cross-reference to them is resolved.

Without a `deferredProvider` this behaves identically to `DefaultLinker`. |
| [RuneDslScopeProvider](rune-dsl-scope-provider.md) | Custom scope provider for the Rune DSL.

Handles the 21 cross-reference patterns from the original Xtext implementation:
- Cases 1-3: Feature calls (-> and ->>)
- Cases 4-8: Operation assign root, segments, constructor keys
- Case 9-11: Switch case guards, enum values
- Case 12: Symbol references (most complex — context-dependent)
- Cases 13-21: Annotation paths, external refs, etc. |
| [RuneDslValidator](rune-dsl-validator.md) | Custom validator for the Rune DSL.

Implements structural, naming, expression, and reporting validations
ported from the original Xtext implementation.

Rule categories:
- S-##: Structural constraints (duplicates, cycles, missing fields)
- N-##: Naming convention rules
- E-##: Expression validation rules
- R-##: Reporting validation rules |
| [RuneStoreHydrator](rune-store-hydrator.md) | Hydrator variant for the Rune store substrate.

Differences from DefaultHydrator:
 - CST nodes are dropped entirely — the store has no use for parse-tree data.
   (`$cstNode`, `$containerIndex`, and `$containerProperty` are deleted from
   the output so the runtime object matches the `Dehydrated<T>` type, which
   excludes all Langium runtime fields.)
 - `$cstText` (a custom field stamped by `preserveCstText` BEFORE dehydration)
   is preserved — the visual editor's expression cells read it after the
   round-trip, and DefaultHydrator would otherwise drop it as a `$`-field.
 - References are stored as `{ $refText: string }` only — the editable `Dehydrated<T>` wire format.
 - Re-hydration rebuilds a proper `Reference` via `this.linker.buildReference`, passing
   `undefined` for the CST node (consistent with the drop above).
 - $namespace is stamped from the enclosing RosettaModel before $container is stripped. |