# Projection utility scrub

The audit covers recorded function bodies and condition predicates across the pinned
CDM, FpML and Rune DSL corpora, including existing code. Runtime definitions are
excluded from the counts. TypeScript has 2,538 fragments and Python 2,539; the
backends differ slightly in their declaration coverage.

| Fragments containing a `rune.*` call | Before | After |
| --- | ---: | ---: |
| TypeScript | 1,413 | 337 |
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
| Structural equality and identity | `valueKey` 336, `equals` 71 | `equals` 568 | Object comparison ignores absent/null fields and handles nested ordered collections. Replacing it with identity equality or ordinary dictionary equality would change behavior. |
| Metadata construction/conversion | `toField` 101, `withMeta` 91, `toReference` 28, `asKey` 11 | `toField` 114, `withMeta` 91, `toReference` 29, `asKey` 11 | Wrapper conversion, reference-only payloads, keys, address merging and evaluation order remain authoritative. A native presentation would need to expose those actual operations. |
| Structural collection operations | `distinct` 17, `contains` 6, `disjoint` 1 | `distinct` 17, `contains` 6, `disjoint` 1, `ordered` 11, `reduce` 2 | Primitive cases are native. Remaining cases need structural keys, metadata accumulator conversion or unresolved key facts. |
| Authored boundaries and nested assignment | None in these namespace-call families | `cardinality` 2,988, `single` 143, `assign` 369 | These include call/constructor bounds, many-to-single conversions and nested writes. Valid Rune expressions can produce absent or multiple values. The display omits export scaffolding but still records these expression/assignment operations. |
| Calendar precision and explicit conversions | `dateConstructTemporal` 1 | `dateField` 102, `temporalKey` 76, `divide` 64, `toString` 29, `number` 2, `dateConstruct` 1 | Python preserves nanoseconds, expanded years, timezone behavior and JavaScript-compatible division/conversion rules. Ordinary Python datetime/division/string conversion is not an interchangeable implementation. |
| Abstract implementation binding | None | `native` 58 | These represent declared external implementations rather than generic utilities. |

A fully native display of the remaining operations needs a presentation decision
for larger algorithms. Executable exports may retain specialized helpers. The
current scrub removes routine utilities without substituting inaccurate operations
for the remaining cases.

## Constructor review finding

Complete TypeScript constructors retain checked literal inference through
`satisfies`. An explicitly authored implicit-empty composite (`Point { ... }`)
uses a builder assertion so nested required fields can be assigned afterward.
The assertion applies to the composite placeholder, not its primitive inputs or
enum literals. Strict compilation and execution cover a nested empty Point inside
a complete Box, subsequent field writes and the enum sibling.

## Verification

- Full codegen suite, with Python 3.14: 2,299 tests passed; one existing skip and eight todo cases.
- Studio projection, all 117 CDM reference parity cases and codegen preview: 165 tests passed.
- Pinned corpus: 132 generated TypeScript files compile strictly across 189 source documents.
- Workspace and codegen type checks, changed-file lint and formatting pass.
- Golden outputs were regenerated through the real emitter.

New checks cover empty collections, operand evaluation count, metadata wrapper
identity, primitive quantified equality/NaN, optional Temporal equality, Temporal
collection ordering, native Python Unicode sets, completed primitive return bounds
and execution of the displayed Python body over typed data.
