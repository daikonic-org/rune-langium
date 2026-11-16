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

## CI restore timeout on `68d38c80`

[CI 43914006715](https://github.com/daikonic-org/rune-langium/actions/runs/43914006715)
still failed J9's form budget (6,237/5,000 ms), J20's warm source budget
(10,408/10,000 ms), and J11's 120-second overall timeout. Code review found no
issues; that does not establish runtime readiness.

J11 verified its curated download at 63.76 seconds, then reloaded. Its restored
workspace submitted 53 local source files in a 305,543-byte request to `/api/parse`,
without curated bundles. The trace console records the existing 45-second router
timeout followed by browser parsing. The Workspaces button appeared roughly two
seconds after that fallback began; its locator had waited about 47 seconds. The
remaining overall test budget expired during the next scratch workspace parse.
The final screenshot showed “Parsing files…” rather than a crash screen.

A read-only replay of the exact request from the development machine succeeded
in 6.00 seconds (4.59 seconds to first byte), returning about 13.6 million
serialized-model characters. This is one replay, not a regional comparison. The
CI runner was hosted in Azure West US 2. A contemporaneous LSP invocation reached
Cloudflare PDX with a recorded TCP RTT of 9 ms; this measures a different endpoint
and cannot establish the parse request's latency. Cloudflare telemetry returned
no Pages parse events for the failure window. Server execution, response delivery
and regional variability remain unseparated.

The source confirmed a definite availability issue: App removed both the rail
and perspective host while restoring or parsing. Preparation now retains the
shell, blocks workspace editing surfaces while pending, and permits Workspaces
and Settings navigation. Initial Explore selection happens before asynchronous
preparation so completion preserves subsequent user navigation. Pending editing
content uses visibility and inertness to retain Dockview's measurements; hiding
its parent with `display: none` caused a zero-width layout in an initial local
implementation, caught by J11 before push. Workspace synchronization now owns an
abort signal, so switching/closing cancels its HTTP request and skips unnecessary
browser fallback parsing. Existing parse timeouts, semantic readiness and
stale-workspace guards remain in force. This
addresses the blocked navigation; it does not claim to fix the remote timeout or
the outstanding J9/J20 CI performance failures.

Recovery validation: Studio passed 2,758 tests (2 skipped), with types, lint,
format, build, React Doctor and design-contract checks passing. The optimized
J9/J11/J20 journeys passed without retries or budget overruns; J9 form rendering
was 1,543 ms, J11 completed in 40 seconds, and J20's warm source opened in 3,778 ms.
The final J11 replay completed in 38 seconds. A separate controlled browser case
passed in 3.5 seconds while its restore request was deliberately held: navigation
remained reachable, opening a replacement workspace aborted the request, and the
replacement type appeared without the old workspace's type. These are local
checks; current-head CI remains required.

An isolated four-request replay after browser testing returned HTTP 200 for all
requests through Cloudflare BOS. First-byte times were 3.28–5.83 seconds and total
times 5.28–9.17 seconds. This used curl's uncompressed response transport and is
not directly comparable with the browser trace. It did not reproduce the
45-second tail, establish a regional cause, or justify relaxing a timing budget.
