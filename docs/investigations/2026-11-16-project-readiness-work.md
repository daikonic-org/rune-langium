# Repeated work in captured project readiness

PR #712's `91f80514` passed code review but failed the complete candidate evidence
gate in [CI 43779943084](https://github.com/daikonic-org/rune-langium/actions/runs/43779943084):
J9's BusinessCenters form took 5,579 ms against its unchanged 5,000 ms budget.
The preceding head's 4,467 ms CI sample did not establish adequate tail margin.

## Observations

An optimized local diagnostic recorded two `preview:setFiles` messages for the
same captured receipt. Each carried 420 reference documents, about 84.7 million
characters of serialized AST JSON. That is a string-length measurement, not a
measurement of structured-clone memory or network bytes. The second message
followed Explorer's transition from 53 view files to 473 materialized files.
The captured program had not changed. Worker-side graph reuse already avoided
recompilation, but it did not avoid the second transfer or instance revalidation.

Main-thread profiling also identified JSON metadata work in reference-view
materialization. The code built a legacy URI alias index before checking whether
the worker's canonical document identities already matched the view.

Cold selection timing can include different amounts of background preparation.
An initial ordinary sample took 1,533 ms; another with main-thread slowdown took
694 ms because preparation had completed earlier. Those are not a speedup
comparison.

## Changes and safeguards

- CodegenProvider shares an actual acknowledgement for identical worker,
  workspace epoch, canonical receipt and view files. Changed view files receive
  their own revision and acknowledgement but refer to the already prepared or
  in-flight program by receipt. A new source/configuration receipt transfers and
  prepares the full project again.
- Instance revalidation follows an acknowledged program receipt once per worker
  and workspace, rather than repeated view-file notifications.
- Consumer cancellation does not cancel shared preparation. Failed or expired
  acknowledgements are evicted. The existing 30-second readiness deadline bounds
  a lost reply; late replies cannot validate the expired operation. Transport
  failures retain the existing unavailable-worker behavior.
- Canonical reference-view identities are resolved directly. Legacy URI aliases
  still use the verified metadata path and reject ambiguous ownership, but their
  metadata index is built only if a legacy alias is actually needed.
- `previewPrepareProject`, `previewSyncView` and `referenceMaterialize` are
  recorded in the existing bounded perf log without input/output content. J9
  retains the preparation spans before navigating to its scratch workspace and
  checks that a successful preparation is present. This adds diagnostic detail
  without changing timing budgets or enabling verbose trace logging.

Full canonical parsing, linking, override handling, resource binding and
validation remain required. The changes do not substitute a partial form schema
or bypass reference verification.

The first local implementation coalesced all updates by program receipt. The
combined candidate run caught a J19 read-only projection failure: original source
bytes had arrived without changing that receipt, so the worker correctly refused
to project an older view. That implementation was not pushed. The corrected
protocol separates source-view acknowledgement from program reuse and retains
the strict source checks. Real-worker regressions exercise TypeScript/Python
projections while preparation is in flight, reject missing/conflicting prepared
receipts without replacing valid state, and refuse obsolete source bytes.

## Local controlled cold-worker diagnostic

The diagnostic held captured-project messages until selection, then released
them to force cold preview-worker preparation. Each sample used a fresh context
and the same captured receipt. The baseline bundle used the verified parent
sources overlaid during an isolated build; no checkout reset or new worktree
was used. The local CPU profile ran in both variants. These are diagnostic local
samples, not production or CI latency claims.

| Variant | Cold samples (ms) | Reference-bundle transfers | Warm revisit samples (ms) |
| --- | --- | --- | --- |
| Parent | 2,099 / 2,150 / 2,125 | 2 | 153 / 153 / 157 |
| Initial shared preparation (before source-view correction) | 2,461 / 2,007 / 2,015 | 1 | 162 / 155 / 163 |
| Corrected program/source-view split | 2,024 / 2,540 / 2,519 | 1 | 160 / 161 / 155 |

These small latency samples do not establish a large wall-clock gain or a p95
improvement; full graph preparation still dominates a cold worker. The initial
implementation's samples are retained as investigation history, not validation
of the corrected source-view protocol. Final end-to-end candidate checks and
current-head CI remain the acceptance gate. Work-count regressions complement
that gate: unchanged captures must not silently return to repeated full-bundle
transfers.

The corrected replay buffers both full-program and receipt-only messages until
selection, preserving their dispatch order. Each of its three fresh contexts
transferred 84,701,155 reference JSON characters once and sent one receipt-only
view update. The parent transferred that bundle twice. This establishes reduced
transfer work, not a cold-start latency gain.

## Corrected implementation verification

- Studio: 2,755 passed, 2 skipped; type checks, scoped lint/format, optimized build
  and the React Doctor regression gate passed.
- The optimized 15-case group passed with zero retries, soft findings or timing
  overruns. It covered first-open Inspector/Graph, form preview and execution,
  curated original-source projections, pinned-cache reload, blank-workspace
  Nightly/7.8.0 restore, both gas examples, execution-catalog import, and prepared
  calculations with valid/invalid/unavailable base validation.
- The grouped J05 first content/fully linked measurements were 230/1,166 ms.
  Curated J9 form rendering was 1,477 ms. Separate fresh J9 checks measured
  1,398/1,483/1,452 ms against the unchanged 5,000 ms budget. These remain local
  samples, not a p95 or CI performance claim.
- Shared-preparation contracts cover acknowledgement matching, source-view
  refresh during preparation, workspace/receipt invalidation, consumer aborts,
  lost acknowledgements, late replies, retry and worker failure. J9 preserves the
  applied-program spans across its scratch-workspace navigation with distinct
  navigation identities.

Current-head CI, including complete candidate evidence verification, is still
required before merge. No timing thresholds or CI retry policies were changed.
