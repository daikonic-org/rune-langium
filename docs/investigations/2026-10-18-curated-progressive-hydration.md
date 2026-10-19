# Curated Inspector declaration-first hydration

Issue: [#545](https://github.com/pradeepmouli/rune-langium/issues/545).
This is a first implementation; deployed acceptance remains pending.

## Langium guidance and implementation

[Langium's document lifecycle](https://langium.org/docs/reference/document-lifecycle/)
requires computed scopes before resolving references. Its
[`BuildOptions.eagerLinking`](https://eclipse-langium.github.io/langium/interfaces/langium.BuildOptions.html)
permits lazy reference access, but omits linking diagnostics and reference indexing.
The installed Langium 4.4.0 source retains that contract. The normal parser worker
already uses lazy linking; changing that flag cannot shorten the closure download.

The parse result now publishes immutable namespace seed metadata through the same
workspace-state boundary as the catalog. This is independent of whether background
cache seeding is enabled. Selecting a deferred declaration starts a parallel read
of its exact pinned namespace artifact, preferring IndexedDB. The existing curated
fetcher validates and decodes a missing artifact. This explicit foreground read
also pauses background speculation.

The parser worker creates isolated Langium services, uses Core's canonical
`hydrateModelDocuments`, builds scopes with `eagerLinking: false`, and returns the
normal serialized snapshots. The existing `astToModel` adapter and read-only
`EditorFormPanel` display the selected declaration. Already authoritative type
options and inherited nodes remain usable. A visible dependency-loading notice
and `data-inspector-readiness="declaration"` distinguish this view from normal
linked content. The temporary models never enter the workspace, graph, preview,
codegen or hydration-readiness stores. Expressions and previews continue through
the existing full dependency path.

Selection, workspace/activation scope and immutable artifact identity guard late
results. Finishing full hydration cancels the early read. Failed or unavailable
early reads leave the ordinary loading/error path in charge. An older server
without seed metadata keeps the existing behavior. No timeout was widened.

An alternative compact Inspector artifact would reduce the namespace bytes, but
would add a producer/schema/cohort compatibility surface and a second maintained
projection. The measured isolated worker requests are only 12–28 ms on cold
reads. Reusing canonical published models and adapters is the smaller first step;
a compact artifact needs evidence that namespace size, rather than the closure,
is now limiting first content.

## Repeated local CDM comparison

Evidence:
`dist/curated-stage-probe/progressive-2026-10-18T22-54-26-017Z/results.json`.
The ignored driver is `dist/curated-stage-probe/progressive.ts`:

```sh
PROBE_COUNT=3 pnpm exec tsx dist/curated-stage-probe/progressive.ts
```

Twelve fresh Chromium contexts cover two types, two modes and three repetitions,
with A/B order alternated between repetitions. Each context also reloads once.
The control omits seed metadata, retaining the ordinary full-hydration path.
Both modes use the same application and real published cohort through the current
Pages handler running locally; the artifact requests use a CORS proxy to model
production's same-origin access. Background speculation is disabled with
`saveData` to isolate the declaration-first change. A MutationObserver measures
actual populated attribute content, the authoritative Inspector marker, and a
real form field separately. Reload measurements include navigation and reopening
the Inspector. Screenshots were excluded from timed sections. Worker RPC samples
include queueing, processing and message transfer; they are not pure build times.

Medians in milliseconds:

| Type | Mode | Cold first fields | Cold linked | Cold form | Reload first fields | Reload linked | Reload form |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| BusinessCenters | Ordinary | 1,431 | 1,431 | 1,442 | 2,102 | 2,102 | 2,117 |
| BusinessCenters | Progressive | 830 | 1,530 | 1,542 | 1,281 | 2,100 | 2,102 |
| Counterparty | Ordinary | 1,404 | 1,404 | 1,419 | 1,950 | 1,950 | 1,965 |
| Counterparty | Progressive | 781 | 1,488 | 1,503 | 1,251 | 2,040 | 2,057 |

First fields improved by 42–44% cold and 36–39% after reload. The largest of the
six progressive cold first-content samples was 1,309 ms. Full readiness did not
improve consistently: cold median completion was about 84–100 ms slower, while
reload completion ranged from 15 ms faster to 92 ms slower. The early read and
extra form render have a cost; this change is not a claim to have removed closure
processing or later main-thread stalls. The sample is too small and the host too
uncontrolled to establish production p95 acceptance.

The cohort was `cohort-483c13b67b6910f1b9ff93ef5ed264b6628cb48e8f1d61929954a10fb3f6c315`.
The progressive full cold response still contained 30,746,501 decoded bytes, with 100 documents and
44 immutable artifacts. Progressive reads added one namespace request per cold
context: 135,714 gzip bytes for `cdm.base.datetime`, and 56,827 for
`cdm.base.staticdata.party`. No namespace request repeated after reload. Warm
closure requests advertised all 44 keys, returned no curated model documents,
and transferred 392,203 decoded bytes including non-curated documents/catalog
metadata. These local decoded sizes are not production Brotli transfer sizes.

The independent namespace worker read took 27–28 ms for BusinessCenters' three
documents (1,118,690 serialized characters), and 12–14 ms for Counterparty's three
(389,092 characters). Warm reads were 27–105 ms and 11–13 ms respectively.
Full 100-document registration RPCs took 10–15 ms, excluding later linking;
selected-document link RPCs generally took about 157–183 ms. Server closure
responses in progressive samples took 297–344 ms cold and 126–144 ms warm.
These overlapping stage times must not be added together. All 24 cold/reload
flows had zero page errors. Local network LSP was unavailable, so this is not an
LSP or production UX sign-off.

## Regression coverage and remaining acceptance

- Worker tests use actual canonical artifacts, require own fields without the
  dependency namespace, and verify that isolated reads do not replace the active
  worker's documents. Malformed reads do not poison later requests.
- Service tests cover exact cache identity, corrupt/missing/mismatched entries,
  normal fetch fallback, cancellation, mutable identity rejection and absent
  selected declarations.
- Component tests cover selection/workspace/cohort changes, read-only controls,
  older servers, failures, and late completion after full content wins.
- The browser regression withholds the full response until real fields are
  visible, then checks previously linked inherited Inspector content, a genuine
  preview field, original Source, and reload reuse. It runs with the existing
  real-worker/IndexedDB cache and background-seeding suites.
- J05 now records `inspectorFirstContent` and full `hydration` from the same
  selection start, and explicitly requires linked content after the first fields.
  Its first-content soft budget is 3 seconds; the full budget is unchanged.

Keep #545 open for repeated deployed measurements, larger namespaces and the
remaining full-readiness costs. #540's intermittent long tail and #582's form
budget remain separate. No application deployment was performed for this work.

Local validation completed:

```sh
pnpm --filter @rune-langium/studio exec vitest run
# 224 files; 2,068 passed, two existing skips
PLAYWRIGHT_BASE_URL=http://127.0.0.1:5187 pnpm --filter @rune-langium/studio exec playwright test test/e2e/curated-progressive-inspector.spec.ts test/e2e/curated-cache.spec.ts test/e2e/curated-background-cache.spec.ts --retries=0
# 10 passed; progressive journey rerun after instrumentation wrapping: one passed
pnpm run type-check
pnpm --filter @rune-langium/studio run build
```

Changed-file lint/format and strict compilation of the new tests/J05 also passed.
The build retains its existing tree-sitter eval/mixed-import warnings.
