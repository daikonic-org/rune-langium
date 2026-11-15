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

### Managed reference captures (2026-11-15)

J05 on PR #711 reported first content at 4,378 ms and linked content at 4,409 ms.
Managed references intentionally have no legacy cache seeds, so that route never
started the declaration-first read. Simply passing captured documents to the
worker did not help: a browser message probe showed the inspection queued behind
the initial local-dependency link, which returned 136 models in that run.

The managed path supplies its verified namespace documents to the same
isolated Core reader in a dedicated, short-lived worker. The parser worker
delegates its legacy inspection request to that shared implementation. Reads are
limited to two million serialized characters; large namespaces or captures without namespace
metadata keep ordinary loading. Canonical hydration, lazy scopes, serialization
and the existing model adapter remain authoritative. No temporary nodes enter
the workspace, Graph, Preview or codegen state.

The source follows the captured reference-document array, so publishing the full
semantic file view does not restart an unchanged declaration read. Source and
workspace identity still reject late results. Legacy requests retain their
immutable cache identity even if a caller reconstructs an equivalent seed object.

Local optimized-candidate samples using the unchanged J05 journey:

| Mode | Samples | First populated fields (ms) | Fully linked (ms) |
| --- | ---: | ---: | ---: |
| Before | 1 | 1,745 | 1,749 |
| Initial UI-host captured read | 4 | 177–210 (median 181) | 1,817–2,134 |

These are cold browser contexts on one development machine using public hosted
APIs, not a controlled CI or p95 comparison. First content improved by about 90%
in this sample; full completion was 68–385 ms slower. This targets time to useful
read-only content, not faster dependency linking. J05's 3-second first-content
budget and independent linked-readiness assertion remain unchanged.

Evidence is under ignored `dist/reference-progress-work/j05-comparison.json`
and the corresponding `j05-*-report/run-manifest.json` files. Regression checks
cover direct captured reads while the parser request remains pending, no legacy
artifact fetch, oversized/missing captures, capture replacement and cancellation.

#### Regression follow-up

The first PR #712 CI run failed J04c Graph hydration and J19's curated function
editor; J9's curated form exceeded its 5-second budget. These remain acceptance
failures even though both the merge base and initial candidate passed the same
four journeys locally. The temporary function form omitted Studio's custom
implementation/projection slots, and a speculative Core read on the UI thread
could compete with full hydration. The follow-up keeps functions on the full
Inspector path and moves captured declaration reads into an abortable dedicated
worker. Both worker transports share one request handler and Core reader.

The local comparison used optimized builds from merge base `cf0c263` and initial
head `57a68db`, with source overlays rather than changing the active checkout.
The worker follow-up retained the same test inputs and budgets:

| Measurement | Merge base (ms) | Initial UI-host read (ms) | Dedicated worker (ms) |
| --- | ---: | ---: | ---: |
| J05 first populated fields | 2,018 | 170 | 225 |
| J05 fully linked | 2,022 | 1,932 | 1,743 |
| J9 curated form | 2,561 | 2,298 | 2,419 |

These single local samples do not establish CI performance or attribute every
failure to the same cause. The original UI-host CI result is not waived. Worker
tests additionally cover cancellation, late replies, timeouts, transport failures
and release after synchronous posting errors. Evidence is under ignored
`dist/reference-progress-work/regression-{baseline,head,fixed}-report`.

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
