# Curated hydration timing follow-up

Follow-up evidence for [issue #540](https://github.com/pradeepmouli/rune-langium/issues/540), collected on 2026-10-10. No performance fix or cold-deployment recovery is claimed.

Three isolated Chromium development contexts used the real production `/api/parse` responses for first navigation to `cdm.base.staticdata.party.Counterparty`. Existing instrumentation ran at trace level with `timingOnly`, restricted to parse/hydration operations. Each context began without browser artifact caches. The local request interception adds response parsing and reserialization, so these timings are diagnostic observations rather than a production benchmark.

| Sample | Inspector populated | API fetch and response decode | `parseWorkspaceViaRouter` span |
| --- | ---: | ---: | ---: |
| 1 | 3,811 ms | 1,775 ms | 2,337 ms |
| 2 | 4,508 ms | 2,021 ms | 2,579 ms |
| 3 | 3,260 ms | 892 ms | 1,351 ms |

The first namespace request returned **94 documents** and approximately **29.3 MB of decoded JSON**, comprising 41 curated artifacts plus system documents. The browser recorded 426–437 ms long tasks and another 107–111 ms task after parsing. This establishes substantial initial closure transport and browser work, but does not isolate serialization, linking, graph updates, or React rendering individually. Server request duration is not independently known.

A separate cache probe, run while validation jobs were active, took 6,198 ms on first navigation. Navigating to BusinessCenters then populated the Inspector in 286 ms; revisiting Counterparty took 237 ms without another parse request. The background BusinessCenters request sent all **41 known artifact identities** and returned only **three system documents**, approximately 349 KB of decoded JSON. The curated closure was reused. The initial request in that probe took 3,301 ms to fetch and decode; the parse span was 4,466 ms, with a 612 ms browser long task. Concurrent local validation makes this sample unsuitable for a regression comparison.

The next investigation should isolate browser graph/render work from response decode and worker hydration using the existing diagnostic operations, then compare the same closure in cold and warm production contexts. Preserve immutable artifact receipts, cross-bundle linking, and full browser namespace caches. Do not trade reference correctness for a smaller first response. The intermittent post-deploy >30-second case remains unproven by these samples and issue #540 remains open.
