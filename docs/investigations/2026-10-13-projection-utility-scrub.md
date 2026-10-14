# Projection utility scrub

The audit covers recorded function bodies and condition predicates across the pinned
CDM, FpML and Rune DSL corpora, including existing code. Runtime definitions are
excluded from the counts. TypeScript has 2,538 fragments and Python 2,539; the
backends differ slightly in their declaration coverage.

| Fragments containing a `rune.*` call | Before | After |
| --- | ---: | ---: |
| TypeScript | 1,413 | 258 |
| Python | 2,519 | 1,250 |

These counts include abstract native bindings as well as utilities. The projections
are not entirely helper-free. The remaining families are listed below rather than
hidden by renaming calls.

## Native rendering

Both backends use native collection materialization, count, presence, first/last,
only-element, filter/map, reverse and flatten. TypeScript also renders singleton
arithmetic, Cartesian ordering comparisons and primitive quantified equality
without utility calls. The same source builders generate the executable runtime's
algorithms, preserving positional equality, broadcasting, empty cases and evaluation
count. Typed Temporal values use native field/equality/ordering operations, including
optional equality and collection sorting.

Primitive distinct/contains/disjoint use native sets and comprehensions. Metadata
deduplication retains the first wrapper for a payload. Python keys preserve UTF-16
string identity and IEEE NaN identity, matching the executable runtime. Python
navigation and metadata unwrapping use dictionary access/comprehensions; default and
coalescing preserve false/zero/empty-string values and lazy fallbacks. Sorting known
primitive keys uses native ordering with the existing null placement.

`collection-shape` reuses linked navigation/cardinality facts and distinguishes
arrays from expressions with mixed scalar/array branches. Native flattening retains
the mixed branches' TypeScript types. Completed primitive function returns can reuse
their enforced return bounds. Output accumulators, composite returns and metadata
payloads retain the checks they still require.

Python's recorded display body excludes export input normalization and the final
export boundary check. Its authored statements still come from the same renderer
as the executable export. Export declarations retain boundary behavior.

## Remaining projection calls

| Family | Remaining TypeScript calls | Remaining Python calls | Assessment |
| --- | ---: | ---: | --- |
| Structural equality and identity | `equals` 71 | `equals` 568 | Scalar TypeScript display comparisons use purpose-built Rune objects' `.equals()` with canonical recursive semantics; executable JSON exports still use structural keys. Structured collection comparisons and Python comparisons retain absent/null and ordered-collection behavior. |
| Metadata construction/conversion | `toField` 101, `withMeta` 91, `toReference` 28, `asKey` 11 | `toField` 114, `withMeta` 91, `toReference` 29, `asKey` 11 | Wrapper conversion, reference-only payloads, keys, address merging and evaluation order remain authoritative. A native presentation would need to expose those actual operations. |
| Structural collection operations | `distinct` 17, `contains` 6, `disjoint` 1 | `distinct` 17, `contains` 6, `disjoint` 1, `ordered` 11, `reduce` 2 | Primitive cases are native. Remaining cases need structural keys, metadata accumulator conversion or unresolved key facts. |
| Authored boundaries and nested assignment | None in these namespace-call families | `cardinality` 2,988, `single` 143, `assign` 369 | These include call/constructor bounds, many-to-single conversions and nested writes. Valid Rune expressions can produce absent or multiple values. The display omits export scaffolding but still records these expression/assignment operations. |
| Calendar precision and explicit conversions | `dateConstructTemporal` 1 | `dateField` 102, `temporalKey` 76, `divide` 64, `toString` 29, `number` 2, `dateConstruct` 1 | Python preserves nanoseconds, expanded years, timezone behavior and JavaScript-compatible division/conversion rules. Ordinary Python datetime/division/string conversion is not an interchangeable implementation. |
| Abstract implementation binding | None | `native` 58 | These represent declared external implementations rather than generic utilities. |

Purpose-built Rune objects provide the accepted display contract for scalar
TypeScript recursive equality. Their method represents the existing shared
comparison behavior; it does not introduce JavaScript operator overloading.
Remaining specialized collection, metadata and calendar calls are preserved
when replacing them with ordinary language operations would change behavior.

## Constructor review finding

Complete TypeScript constructors retain checked literal inference through
`satisfies`. An explicitly authored implicit-empty composite (`Point { ... }`)
uses a builder assertion so nested required fields can be assigned afterward.
The assertion applies to the composite placeholder, not its primitive inputs or
enum literals. Strict compilation and execution cover a nested empty Point inside
a complete Box, subsequent field writes and the enum sibling.

## Verification

Unique cross-namespace TypeScript calls now retain their exported names. Protected
aliases remain for collisions and local shadowing; caller-scoped lazy captures
keep single-file bundles safe when multiple modules shadow a callable or a native
binding appears later in the bundle. All three layouts have strict compilation
and execution coverage, including library calls, pipelines and inherited calls.

Preview Data inheritance uses Zod's `safeExtend`, preserving parent refinements
when a child overrides fields. The shared refined-parent fixture covers child and
grandchild validation through both the standalone generator and Studio's real
worker; valid data passes and parent/child condition failures remain visible.

Calendar navigation also uses the shared shape-aware materializer before mapping.
A conditional, default or alias may legitimately return a single calendar value
on one branch and a list on another. Both Temporal and ISO predicate modes retain
those shapes, missing/empty cases and single receiver evaluation. Strict export
checks cover date, date-time and zoned date-time navigation, aliases and implicit
pipeline fields.

Constructor presence is shared by TypeScript, Python, list materialization and
cardinality adaptation. Empty Choice constructors are absent; empty Data builders
remain objects. Linked expression and strict export tests cover empty/mixed lists,
aliases and required output/argument failures, including Python execution.

- Full codegen suite, with Python 3.14: 2,307 tests passed; one existing skip and eight todo cases.
- Studio projection/formatting, all 117 CDM parity cases, source navigation and previews: 284 tests passed.
- Pinned corpus: 132 generated TypeScript files compile strictly across 189 source documents.
- Workspace and codegen type checks, changed-file lint and formatting pass.
- Golden outputs were regenerated through the real emitter.

New checks cover empty collections, operand evaluation count, metadata wrapper
identity, primitive quantified equality/NaN, optional Temporal equality, Temporal
collection ordering, native Python Unicode sets, completed primitive return bounds
and execution of the displayed Python body over typed data.

Positional public APIs preserve Rune declaration order, ordinary input names and
types, including optional-before-required inputs. Direct TypeScript strict/runtime
and Python execution checks cover zero/multiple inputs, escaped keywords, result
accumulator collisions and shadowed builtins/callables. The existing corpus stores
named records; test-only invocation adapters map those records into the positional
API without changing internal generated calls. Six function goldens were regenerated
through the public emitter. Both reverse expression-lens suites still pass.

The 10 local expression browser journeys pass, including the actual browser Ruff
WASM loader, date form execution, continuous formatted bodies, source comment
clicks and narrow layout checks. The network LSP journey skips without its server.
Formatting made Python bodies longer than CodeMirror's virtualized viewport; the
journey now reads the full editor document for whole-body assertions.

Studio's production build passes. Its existing advisory JS size limit remains
exceeded: 14,977,529 bytes versus 6,593,600. An archived HEAD Studio build with the
same workspace dependencies and current compiled codegen measured 13,779,620;
lazy formatter JS chunks account for 1,195,886 of the increase. The shared codegen
ABI differs slightly from that HEAD source baseline, so this comparison isolates
the Studio formatter addition rather than claiming a byte-exact old-revision build.
Ruff's separately loaded WASM asset is 1,215,985 bytes. CI already treats this
budget as advisory; its threshold has not been raised. The existing Changesets
private-dependency configuration remains tracked by #594.

Fresh-head CI exposed a development-only formatter discovery race: Vite optimized
worker formatter subpaths after the Inspector was ready and reloaded the page
while the schema HMR test recorded its no-reload token. The same failure reproduced
locally before the fix. Canonical Vite config now discovers browser formatter
subpaths up front and excludes Node-only Ruff; both cold-cache schema HMR cases
pass (zero and 1,000ms artificial transform delay), without extending their
2-second limits or weakening reload detection.

Source navigation's shared Rune lexer now carries quoted string state across
lines. Real CodeMirror state tests reproduce false `fake.is` selections inside
multiline documentation and lost navigation after comment markers in a string;
both quote styles, escaped quotes, ignored namespace text and the next real
declaration now pass alongside the existing Source editor checks (61 tests).

Two positional API review regressions also reproduce on the previous head:
module-reserved `await` inputs were emitted verbatim, and a non-first escaped
`class` input could shadow a called `class_input` function. The shared reserved
word set includes `await`; callable reference resolution compares the final
exported name against both source and emitted local bindings for ordinary,
external/rule and `super` calls. Regression checks parse actual emitted
JavaScript as an ES module, strictly compile TypeScript and execute both target
languages; ordinary Rune parameter names remain unchanged.

Follow-up validation passed 2,308 codegen tests (one existing skip/eight todo),
269 focused Studio checks including all 117 CDM cases, strict compilation of all
132 pinned TypeScript files, full workspace types and changed-file lint/format.
Both cold-cache HMR cases passed at 186ms and 1,210ms without a reload; the two
real-browser formatting/Source/date-form smoke journeys also passed. The earlier
full expression suite's explicit network-LSP skip remains a coverage limitation.

The export follow-up moves bundled TypeScript implementations into `helpers.ts`.
Single-file `model.ts` now imports that companion; both layouts share filename
allocation so namespaces `helpers` and `helpers1` cannot overwrite it. Generic
model packaging marks companions as support artifacts, and the generator keeps
models first with deterministic paths within each group. This matters because
alphabetical sorting alone would make `helpers.ts` the default Studio preview.
Execution tests now load the complete emitted module set through Node's resolver;
strict checks retain metadata, Temporal, native libraries and cross-namespace calls.

Additional positional input regressions reproduced TypeScript Number/undefined
capture diagnostics and Python's `int has no attribute isnan` with a `math` input.
Shared TypeScript binding reservations also protect shortcuts; Python discovers
imported names from its authoritative runtime. Ordinary builtin inputs such as
`len` retain their existing qualified-call behavior. Original input names and
positional metadata remain intact. Codegen passed 2,310 tests (one existing skip,
eight todo), Studio's six focused worker/export suites passed 216 checks including
all 117 CDM cases, and all 132 pinned TypeScript files compile strictly.
Final codegen validation passed 2,312 tests after adding case-insensitive filename
collision coverage and the silent `undefined` sentinel regression. Full workspace
types and scoped lint/format pass. The new browser journey uses actual generated
outputs in a mocked transport envelope: `model.ts` opens first, the helper file
is selectable, and both downloaded files match the previewed bytes. The two
existing function/Temporal browser smoke journeys also pass; hosted transport and
production deployment are not exercised by these local checks.

CI on the preceding head failed only the unchanged 400-node rename timing test
at 101.5ms against 100ms. All 15 focused rename tests passed locally; its threshold
has not changed. Fresh-head CI is still required after the export follow-up.
