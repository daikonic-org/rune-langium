# Open issue review — 2026-11-13

Reviewed all **13 open issues**, their comments, and relevant source/contracts
against master `df8693b175ab841b3c2f19b985ed64ec432db768`. This is a triage snapshot;
it does not close issues or claim the dependency-refresh candidate is deployed.

## Fresh operational evidence

- [Curated run 43421282051](https://github.com/daikonic-org/rune-langium/actions/runs/43421282051)
  failed release reconciliation, then independently built and **successfully
  uploaded** the Nightly artifacts and moving manifest. CDM 5.41.0 failed because
  its POM did not supply an explicit `rune-fpml.version`; 6.31.0 and 6.32.0 failed
  linking `Instrument` in `mapping-dtcc-synonym.rosetta`. These are separate from
  the old first-upload credential failure. The reconciler already attempts the
  other releases and reports an aggregate failure; it must not publish invalid
  artifacts to make the job green.
- [Production UX run 43426680435](https://github.com/daikonic-org/rune-langium/actions/runs/43426680435),
  evidence run `prod-ux-2026-11-13T12:38:25.167Z`, records **65 passing journey
  results and one failure**. J00a verified the current master deployment. The
  workflow intentionally continues after a harness failure, so its overall
  successful conclusion is not a clean UX result.
- The failed `J29:gas-5-10` timed out on both attempts while the reference-example
  dialog displayed **GitHub source unavailable (403)**. It never reached payload
  validation. The 5-13 gas example and execution-catalog journeys passed. Do not
  describe this as recurrence of the old Zod validator exception without evidence.
- `J19:curated-readonly` reached Abs's Rune body, TypeScript/Python projections,
  and protected original source on its first attempt. This is the exact journey
  reported in #624, not a replacement scratch-function test.
- BusinessCenters first Inspector content / linked hydration / form render were
  **424 / 429 / 469 ms**. These selection timings follow reference setup; recorded
  CDM `modelLoad` timings span **27,109–30,878 ms** across 18 samples, with a
  **28,528 ms median**. They are not
  evidence that cold end-to-end reference loading now takes under a second, nor
  a controlled p95 study.

## Disposition by issue

| Issue | Recommended disposition | Evidence and remaining acceptance |
| --- | --- | --- |
| [#515](https://github.com/daikonic-org/rune-langium/issues/515) — first R2 upload | **Completion candidate** | Today's scheduled job passed the actual authenticated upload and published the moving manifest. Safe error reporting was already delivered. Link this receipt when closing the original credential incident; track the three release-compatibility failures separately. |
| [#624](https://github.com/daikonic-org/rune-langium/issues/624) — Abs Inspector hangs | **Completion candidate** | The exact deployed `J19:curated-readonly` journey now passes with all three expected checkpoints, without retry. Preserve it as the regression test and include the current run when closing; this does not prove every historical source-resolution race impossible. |
| [#594](https://github.com/daikonic-org/rune-langium/issues/594) — public/private package graph | **Confirmed open; prioritize release correctness** | `pnpm exec changeset status` still fails: public visual-editor depends on private design-system. Instrumentation-core is now public, so that half of the original description is stale. The existing CLI/LSP closure tests do not cover visual-editor. Decide the design-system publication/bundling boundary, then pack and install codegen/visual-editor in clean consumers and verify runtime imports and version preparation. Do not ignore public packages to silence the graph. |
| [#646](https://github.com/daikonic-org/rune-langium/issues/646) — function implementations | **Keep umbrella open; reconcile completed inventory with follow-ups** | The versioned catalog documents all **49** pinned CDM 7.9.0 declarations: **34 Rune** and **15 TypeScript/Python** implementations. This is cohort coverage, not universal CDM/FpML availability. Keep upstream selector execution counts separate; retain the recorded decimal limits, coupon-context gaps and provider/data requirements. Refresh stale acceptance boxes around delivered precedence, bundle delivery, licenses and representative execution, while retaining broader/generalization work. |
| [#645](https://github.com/daikonic-org/rune-langium/issues/645) — code lists/build artifacts | **Partly delivered; narrow remaining scope** | The shared runtime materializes populated code lists as ordinary Rune enums; curated delivery, resource provenance, local mappings, save/reopen and common generator/Prototype consumption are documented in the [supported-artifact matrix](../reference-examples/build-resources.md). The issue's unchecked baseline predates that work. Still open: parameterized coding-scheme domain bindings, a dedicated resource browser and genericode/XSL execution. Do not equate retained XML bytes with a working XML codec. |
| [#647](https://github.com/daikonic-org/rune-langium/issues/647) — reference examples | **JSON milestone delivered; retain FpML/XML milestone** | JSON/RUNE_JSON import, provenance, metadata and explicit function bindings have shared native/Studio paths and pinned fixtures. The [remaining XML contract](../reference-examples/README.md#fpmlxml-milestone-remaining-work-under-647) still requires namespace/version binding, ID/href preservation, bounded parsing and explicit translation semantics. Today's J29 403 is an acquisition failure before those codecs; address it separately. |
| [#582](https://github.com/daikonic-org/rune-langium/issues/582) — BusinessCenters latency | **Keep performance incident open; refresh measurements** | Today's form sample is below the unchanged 5,000 ms budget, and J06/J18 pass; the CDM closure walk still takes 15,858 ms. A single successful run does not explain the historical regression or establish a distribution. Compare repeated same-cohort cold/warm selection, full reference setup, hydration and closure timings with correlated backend stages. |
| [#540](https://github.com/daikonic-org/rune-langium/issues/540) — cold hydration tail | **Keep open; prioritize measured startup work** | Reference setup spans 27–31 seconds in today's artifact. Its `modelLoad` boundary differs from selected-declaration hydration, so correlate the stages before attributing the delay. The evidence bundle's known-issue entry expired on November 10; review its ownership/expiry rather than silently extending it or increasing budgets. |
| [#545](https://github.com/daikonic-org/rune-langium/issues/545) — progressive Inspector | **Implementation delivered; acceptance pending** | [Declaration-first hydration](2026-10-18-curated-progressive-hydration.md) reuses canonical namespace models and preserves full-link readiness. Today's first-content sample is encouraging but follows reference setup. The issue still needs repeated deployed first-content p50/p95 measurements, larger namespaces and separate full-readiness accounting. Do not merge this architectural acceptance with #540's incident. |
| [#592](https://github.com/daikonic-org/rune-langium/issues/592) — StringEquals projection stall | **Hardened; keep incident open** | Deadline/retry/late-result protection and worker fixtures are delivered. Today's StringEquals execution and code-generation journeys pass, but they do not establish the exact original execute-then-project cold/warm action order. Repeat that lifecycle with matching deployment/cohort and per-stage timings before claiming root-cause resolution. |
| [#574](https://github.com/daikonic-org/rune-langium/issues/574) — z2f L2 | **Keep enhancement open; update stale current-state text** | `EditorFormProvider` now supplies canonical per-field Zod rules through the shared `EditorController`, including nested paths and normalized values. The statement that Controllers have no replacement rules is outdated. L2 is still not enabled or proven: optimized rules/SchemaLite, hidden metadata, all five forms, undo/reset/arrays and interaction benchmarks remain required. A configuration-only switch is still unsafe. |
| [#572](https://github.com/daikonic-org/rune-langium/issues/572) — braces backport | **External release blocker** | Live npm still reports **3.0.3**. Retain the structural security patch and its one existing audit exception; the 44 installed-package regression checks pass after the refresh. Remove neither until a published fixed release passes those checks. |
| [#447](https://github.com/daikonic-org/rune-langium/issues/447) — publish-time shapes/cache | **Architectural enhancement remains open** | The browser worker's versioned generation caches already exist, but are not the proposed shared emitter-layer content-addressed cache or published type-shape consumer boundary. The description-only scope probe found names but still required canonical AST materialization for references. Refresh the old eight-link-round description against the current hydrator; require byte-equivalent output and a shared shape-aware design before further work. |

## Suggested work order

1. Resolve #594's remaining public/private boundary and verify real tarball consumers.
2. Handle historical-release compatibility and J29's GitHub 403 as distinct
   operational follow-ups, preserving validation and failure isolation.
3. Measure cold reference setup and its relationship to #540/#582/#545; use the
   existing stage instrumentation before selecting a further optimization.
4. Narrow #645/#647 to their actual remaining resource and XML semantics, and
   reconcile #646's completed pinned inventory with its explicit future scope.
5. Keep #574 and #447 as measured architectural work, and #572 as an upstream
   release watch. Close #515/#624 only with the linked fresh deployed receipts.

## Review limits

No issues were closed, relabeled or commented on, and no production deployment,
publication retry, secret or stored project lock was changed. The dependency
candidate retains resolver 5 and TypeScript 6 where their consumers require them,
preserves Core's existing Langium serialization compatibility floor, and records
two development-only audit advisories without adding suppressions. See the
[dependency compatibility policy](../agents/workflow.md#dependency-compatibility-and-audit-exceptions)
for the exact holds and patch requirements.
