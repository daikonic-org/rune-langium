# Curated hydration latency (#582)

## Evidence and attribution

The October 18/19 production nightly artifacts (workflow runs `39098350506` and
`39201697113`) show J9 BusinessCenters selection-to-preview readiness increasing
from 3448 to 5533 ms. The namespace hydration request rose from 1093 to 2912 ms:
1819 ms of the 2085 ms increase (87%). Headers wait increased 1791 ms, while
response size changed only 2362 bytes (0.08%). Headers wait includes network,
queueing, server work and serialization; it does not establish Worker CPU cost.

Across comparable cold requests for that namespace and a 2.9–3.0 MB response,
median request duration stayed roughly constant: 2319 ms across eight calls on
October 18 and 2330 ms across seven on October 19. Different journeys have
different isolate/cache states; this is descriptive evidence, not a controlled
A/B. The J9 regression is real, but it does not demonstrate a uniform slowdown.
The October 19 nightly includes #615/#616 and precedes dependency update #621.

## Changes

- Cache only validated immutable cohort manifests, keyed by bundle and cohort.
  Share pending promises, retain at most 24 entries using LRU ordering, and evict
  failed reads so later calls retry. Floating/latest and legacy date versions
  continue fetching their mutable pointer every time. Cohort validation and
  cross-bundle conflict detection remain authoritative.
- Replace artifact batches with eight refillable slots. Slow requests no longer
  block the next group. Collect results by their original job index and publish
  after complete success, preserving bundle/document/receipt order. A failure
  stops claiming queued jobs; already-running downloads retain their existing
  timeout and cache behavior.
- Add opt-in, payload-free trace stages for remote manifests, artifact download,
  artifact inflation/validation and parse-response serialization. Existing outer
  operations still distinguish cache hits from misses by the presence of these
  inner stages. No diagnostics or deployment settings are enabled by this change.

This uses the shared loader/fetcher consumed by parse, download and namespace
reads. It does not add a separate preview implementation, weaken the complete
dependency requirement, or remove current-cohort server validation on browser
cache hits. Background prefetch already pauses during foreground parse/source
work. A complete local-cache fast path is a separate design problem.

## Repeatable local replay

Command from the root, using existing canonical artifact-builder outputs:

```bash
node apps/studio/scripts/benchmark-curated-hydration.mjs dist/codegen-corpus-artifacts 426cc5a9104b1e306e35850f831372ed2a18a23f
```

Pinned source commits: CDM `c817e5f78b86c2c61caa9291efc1322697bed5ca`, FpML
`675b4ca8faa27f71e345f127e890202b08456750`, Rune
`8ff5a7b39031876ef06c901102c8d96cf90236c4`. The replay constructs one stable
cohort around these exact artifact bytes and rejects mismatched source metadata.
It supplies responses locally with deterministic 25 ms manifest and alternating
15/120 ms artifact delays, exercising actual gzip/JSON/schema processing.

Three repetitions alternate baseline/current order, using a fresh bundled module
and empty caches for each repetition. Each repetition then tests repeated
isolate loads and browser artifact receipts. BusinessCenters resolves to 41
artifacts / 91 documents in this pinned fixture, distinct from the newer live
cohort previously measured at 44 artifacts / 100 documents.

| Mode | Baseline median | Updated median | Baseline/updated fetch calls |
| --- | ---: | ---: | ---: |
| Cold immutable closure | 733.7 ms | 343.8 ms | 44 / 44 |
| Repeated isolate load | 33.9 ms | 1.5 ms | 3 / 0 |
| Browser receipts | 32.1 ms | 1.3 ms | 3 / 0 |

All nine baseline/current result pairs have identical serialized output hashes;
peak fetch concurrency never exceeds eight. Raw results and stage totals are
written to ignored `dist/issue-582/benchmark/results.json`. Nested/concurrent
stage totals are not additive wall time. The deterministic 16-artifact unit
regression separately demonstrates 2000 → 1010 ms for two stragglers while
preserving order and the concurrency bound.

These measurements establish reuse and scheduling behavior under simulated I/O.
They do not establish production p95, fix the original nightly result, or include
browser linking/form rendering, real edge/network variability or response
compression. Keep #582 open until a fresh production checkout confirms the
5000 ms readiness budget. Use the new stages to separate network/artifact work
from decoding and response serialization before attributing further delays.
