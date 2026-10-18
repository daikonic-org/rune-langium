# Curated performance and optimization boundaries

Follow-up to [#582](https://github.com/pradeepmouli/rune-langium/issues/582),
[#540](https://github.com/pradeepmouli/rune-langium/issues/540),
[#545](https://github.com/pradeepmouli/rune-langium/issues/545),
[#592](https://github.com/pradeepmouli/rune-langium/issues/592),
[#574](https://github.com/pradeepmouli/rune-langium/issues/574) and
[#447](https://github.com/pradeepmouli/rune-langium/issues/447).
No latency fix or incident closure is claimed by this investigation.

## Latest nightly evidence

[Run 39098350506](https://github.com/pradeepmouli/rune-langium/actions/runs/39098350506),
`prod-ux-2026-10-18T04:49:23.025Z`, recorded:

| Operation | Subject | Duration |
| --- | --- | ---: |
| J06 hydration | BusinessCenters | 2,859 ms |
| J9 form render | BusinessCenters | 3,448 ms |
| J18 closure walk | BusinessCenters | 6,244 ms |

J9 was below its unchanged 5,000 ms budget on this run. The corresponding cold
parse HTTP request took 1,093 ms, reaching headers in 863 ms. J00a passed against
that run's master (`e7263c46`); this is evidence at that time, not proof of the
current deployment. Later passing samples do not explain October 17's 5,831 ms
sample or the historical >30-second tail. In #582's October 17 comment, 2,996 ms
is about 85% of the **3,517 ms HTTP request**, not 85% of the entire form render.

J19 still failed with the worker `postMessage` clone error. PR #612 separately
addresses that functional failure; the performance work does not supersede it.

## Isolated diagnostic samples

Chromium used isolated contexts against local Studio at PR #612's `99439f58`,
with codegen stage timing boundaries added for the second series. Only parse
and curated-source requests were forwarded to the real production API. This
adds proxy buffering and development runtime costs, so these are diagnostic
samples, **not a production before/after benchmark**. No validation jobs ran
during these browser samples. User tabs and production were unchanged.

| Series | Cold BusinessCenters selection-to-form | Revisit |
| --- | --- | --- |
| Existing timers, three contexts | 4,583 / 5,778 / 4,416 ms | 61 / 61 / 63 ms |
| Added codegen timers, three contexts | 3,075 / 3,040 / 2,995 ms | 61 / 59 / 50 ms |

The faster second series coincided with faster API proxy requests (692–750 ms,
versus 1,569–2,979 ms in the first series). It must not be attributed to adding
timers. With the added boundaries, each cold sample recorded approximately:

- 94–95 ms summed cache writes across 45 writes;
- 133–136 ms for the initial codegen curated-document hydration;
- 47–49 ms for the initial document build;
- 4–8 ms for subsequent selected-schema generation, including document access.

These nested spans cannot be added as independent costs. They do not identify
cache writes or schema generation as the dominant cold delay. There is still
time outside those spans; first selection, API/response processing, worker
startup and main-thread work must be correlated before changing scheduling.
Progressive Inspector hydration and its first-meaningful-content targets are
not implemented by these measurements.

A separate API receipt captured immediately afterward reported cohort
`483c13b67b6910f1b9ff93ef5ed264b6628cb48e8f1d61929954a10fb3f6c315`,
including `cdm/artifacts/2026-10-17-8eed7607a7f3`. The samples did not independently
pin every response to that receipt. Canonical deployment inspection returned
HTTP 401 with the available local credentials, and correlated Cloudflare logs
were unavailable. Do not claim a server CPU, isolate cold-start or current-head
root cause from this evidence.

## StringEquals action order

Three fresh contexts executed `StringEquals("hello", "hello")` before their
first TypeScript projection; three fresh contexts opened the projection without
executing. Each repeated its own sequence warm. All twelve projections completed
without page errors:

| Order | Cold TypeScript | Warm TypeScript |
| --- | --- | --- |
| Execute first | 134 / 139 / 147 ms | 40 / 39 / 39 ms |
| Projection only | 154 / 148 / 141 ms | 36 / 38 / 38 ms |

Cold execution took 1,343–1,359 ms and returned `true`; warm execution took
60–72 ms. This includes #612's source transport fix and the existing stale/retry
guards. It does not reproduce or explain #592's original production stall.
Production matched-order evidence still requires a deployed source fix and a
verified deployment/cohort.

## Diagnostic boundaries

The codegen worker now uses the existing shared instrumentation wrapper at
five boundaries: `previewHydrateDocuments`, `previewBuildDocuments`,
`previewGenerateSchema`, `previewGenerateProjection` and
`previewExecuteFunction`. All are trace level with zero input/output capture
and a fixed sanitized failure signature. Completion timing is not proof that
the emitted preview result is valid; inspect its normal result/error message.

For a local diagnostic build, set `VITE_INSTRUMENTATION_LEVEL=trace`,
`VITE_INSTRUMENTATION_TIMING_ONLY=true` and `VITE_INSTRUMENTATION_OPS` to the
desired comma-separated operations before starting Vite, then enable diagnostics
in that isolated session. Add `curatedCacheRead`, `curatedCacheWrite`,
`curatedCacheIndex` and `parseWorkspaceViaRouter` to compare cache/router stages.
Production instrumentation retains its existing build and opt-in gates.

The worker regression enables capture generally and still verifies that both
successful and failed stage records contain no source/type names or AST payloads.
Existing cache/version/late-result behavior is unchanged.

## L2 form-validation feasibility (#574)

An exploratory walk of all five canonical AST schemas with published z2f core
0.12.0 at L1 and L2 shows the same root field counts (Data 8, Enum 8, Choice 6,
Function 7, TypeAlias 4). Their `name` fields have **no register validation hints**
at either level, while the canonical field schemas reject an empty name. None
of the root fields gained nonempty native constraint rules. This is a root-field
census, not a claim about every nested cardinality or array child.

The existing `EditorFormProvider` bridge covers canonical identifier unions and
nested paths. Keep that shared validation and the current L1 policy. A simple
level change would neither establish a Rune interaction speedup nor satisfy the
native-rule adapter, SchemaLite/container parity, hidden metadata, autosave and
array/undo acceptance criteria. Walking a schema alone is not a benchmark of
typing or committing a large enum. #574 remains an integration enhancement.

## Description-only scope gate (#447)

`packages/core/test/services/description-only-linking.test.ts` registers only a
published Parent description in a fresh consumer index. The ordinary imported
scope finds it without a document. `RuneDslLinker.loadAstNode` cannot resolve it
until `hydrateModelDocument` registers the real canonical model; afterward the
same description and the user's extends reference resolve to the same AST node.

Name discovery therefore works over description-seeded indexes. It does not
provide AST-free member/inheritance traversal to existing consumers. Retain the
current deferred materialization fallback. A type-shape/emitter cache still
needs a shared shape-aware consumer boundary and output-equivalence validation;
do not introduce a second AST-shaped approximation to bypass that requirement.
The current hydrator also uses shared `deserializeModels`, so older plans that
describe an eight-round hydration loop must be refreshed against current code.

## Verification

- Core: 367 tests across 46 files passed, including the description-only gate.
- Studio: 2,033 tests passed, two skipped across 219 files; the focused worker
  group passed all 248 checks, including all 117 CDM reference parity cases.
- Core and Studio/Pages types and changed-source lint/format passed.
- Probe logs and raw local records are retained under ignored
  `dist/curated-stage-probe/`; they contain diagnostic measurements, not a
  production acceptance result.
