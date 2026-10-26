# Functions

## emit

### `isWholeModelEmitter`
Runtime discriminator between the two emitter contracts. Distinguishes
by prototype shape: `NamespaceEmitter` exposes a `finalize()` method
(plus the per-element `emitData` / `emitEnumeration` / etc. hooks);
`WholeModelEmitter` exposes only a single async `emit()` method.

Used by `generator.ts:runGenerate` (Task 0.4) to dispatch each
target through the appropriate pipeline.
```ts
isWholeModelEmitter(c: WholeModelEmitterConstructor | NamespaceEmitterConstructor): c is WholeModelEmitterConstructor
```
**Parameters:**
- `c: WholeModelEmitterConstructor | NamespaceEmitterConstructor`
**Returns:** `c is WholeModelEmitterConstructor`

### `emitStandaloneZodSchema`
Emit one target type's real Zod schema as a self-contained script — the
target's transitive closure (Task 2) assembled into a single synthetic
`NamespaceWalkResult` and rendered through the real, unmodified
`emitNamespace()` (zod target), never a hand-rolled approximation of it
(per the repo's DRY precept).

The returned `code` is real TypeScript (types, `export`, and — for cyclic
types — an `interface` predeclaration all survive, unmodified), with two
exceptions: the spurious cross-namespace `import` lines described above
are stripped, since every symbol they'd reference is already declared
locally in this same script; and — only when the closure actually needs
it — a JS-safe `runeExtendChoice` definition (Data-extends-Choice
emission) is inlined right after the `import { z } from 'zod';` line,
since that helper is Zod-specific and therefore NOT part of the shared,
Zod-agnostic `RUNTIME_HELPER_JS_SOURCE` bundle the caller is expected to
prepend for everything else. External imports of `z` and `Temporal` are
preserved. Turning this into directly `new Function`-evaluable JavaScript
(erasing types/exports/interfaces/imports and binding `z` and `Temporal`)
is left to the caller, exactly as
`RUNTIME_HELPER_JS_SOURCE` is already caller-prepended rather than
bundled into this return value.

Caveat inherited from `namespace-emitter.ts` (pre-existing there, not
introduced by this function): if `targetId` itself resolves to a
`RosettaTypeAlias` whose RHS is a `Data`/`Choice` (not a primitive or
`Enum`), the emitted alias `const` can reference its RHS `const` before
that RHS is declared — type aliases are always emitted before the
topo-sorted `Data`/`Choice` block, so evaluating the result throws a TDZ
`ReferenceError`. See `test/fixtures/type-aliases/data-ref/expected.zod.ts`
for the same defect in ordinary per-namespace output.

A second, unrelated ordering hazard was found and FIXED directly in
`zod-emitter.ts` (not inherited/unfixed like the above): `topoSort`
always appends cyclic types LAST, after every non-cyclic type, regardless
of whether a non-cyclic type depends on one of them, and `zod-emitter.ts`
previously only wrapped a cyclic type's OWN schema declaration in
`z.lazy()`, never a reference TO it from elsewhere — confirmed to
reproduce in the REAL per-namespace `.zod.ts` output too, not specific to
standalone extraction. Fixed via `schemaRefExpr(name, ownerName)`, which
wraps a cross-declaration reference in `z.lazy()` while leaving
within-a-cycle references (self-references, mutual-cycle members) bare,
matching `test/us1-structural.test.ts`'s existing byte-identical golden
fixture; see `test/emit/zod-cyclic-reference-wrapping.test.ts` for full
coverage, including the related fix folding a cyclic parent's attributes
inline instead of `.extend()` (which `ZodLazy` doesn't support at all).

A THIRD, separate, still-unfixed issue was found alongside this: a Data
extending a CROSS-namespace parent leaks that parent into the child
namespace's own `dataByName`/`emitOrder`, producing both a cross-ns
`import` AND a duplicate local re-declaration of the same schema name —
invalid ES module syntax regardless of cyclic-ness, reproducible against
the already-committed `test/fixtures/data-extends-data-crossns` fixture.
This is a `namespace-walker.ts`-level cross-namespace concern, unrelated
to cyclic ordering, and genuinely out of scope for this module — it is
NOT fixed here.
```ts
emitStandaloneZodSchema(documents: LangiumDocument<AstNode>[], targetId: string, options: { functionInputs?: boolean; metadataInputs?: boolean }): { code: string; diagnostics: GeneratorDiagnostic[]; schemaName?: string }
```
**Parameters:**
- `documents: LangiumDocument<AstNode>[]`
- `targetId: string`
- `options: { functionInputs?: boolean; metadataInputs?: boolean }` — default: `{}`
**Returns:** `{ code: string; diagnostics: GeneratorDiagnostic[]; schemaName?: string }`
