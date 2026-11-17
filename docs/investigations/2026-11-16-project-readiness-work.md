# Repeated work in captured project readiness

## Follow-ups after the accepted PR #712 merge

Exact-head CI 44011646089 still exceeded the J9 form budget (6,771/5,000 ms)
and J20 warm-source budget (10,878/10,000 ms). J19's editor appeared beyond a
five-second assertion, the scaled Inspector collapse click remained unstable,
and a Compose output draft disappeared during refresh. Ordinary optimized local
replays passed those interactions; they do not establish the CI causes resolved.

Local profiles identified repeated canonical JSON metadata reads in the deferred
parser and separate parses for metadata and compact LSP content during artifact
preparation. Core now shares one parse for those two derived views. Verified
reference metadata supplies dependency edges during parser installation; legacy
payloads still derive them from canonical JSON. Malformed transitive artifacts
must continue to reject the whole closure and permit a repaired installation.

Compose facts now belong to a dependency snapshot as well as exact source bytes
and declaration identity. A pending refresh keeps editing disabled, and draft
capture uses the current canonical step rather than a retained graph node's old
region. Failed source capture reports an error. A controlled delayed-refresh
test covers the readiness boundary.
Camera fitting shares current-graph readiness and ignores superseded fit
completions. The selected node must fit within the canvas after a binding Apply.

The Compose CI image also exposed Explore painting beneath the canvas: Dockview
descendants can restore `visibility: visible`. An ancestor opacity guard keeps
the retained workbench measurable and inert while suppressing descendant paint.
Compact shared icon buttons now retain stationary hit targets. The added hover
contract fails against the old optimized bundle; this is interaction hardening,
not proof that hover motion alone caused the CI collapse timeout.

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

## React Doctor, Impeccable and adversarial recovery review

The user-authorized failed-job retry of CI 43932219239 reproduced both Inspector
hot-reload setup failures on `77b55d7a`; each waited for Person navigation before
the schema mutation. The failure is not a proven hot-reload latency problem.

Adversarial local review reproduced two lifecycle regressions. Retaining Explore
mounts its namespace tree before workspace declarations arrive; the one-time
expansion initializer left those namespaces collapsed. The tree now derives
default expansion from the current shallow inventory and stores only explicit
navigation choices, retaining manually folded branches. Separately, restoring
saved files could finish after the user selected Settings and replace that
selection with Explore. Initial selection now precedes the file read. Both
regression tests failed before the fixes and passed afterward.

React Doctor 0.9.23 is both the installed and current registry version. Complete
changed-scope Studio and visual-editor scans use the PR base
`cf0c26317e9ab2f863897218b8350a8097daf82c`. No new correctness errors were reported;
complexity warnings remain observations, not evidence of a runtime failure.
Studio's design-only changed scan reported no diagnostics. The full Studio scan
reported 28 errors and 224 warnings across 832 files, including render-time ref
updates, cleanup analysis and two non-null assertions. These are scanner
diagnostics needing occurrence-level triage, not 252 confirmed defects. The
`entries.find` assertion in the reference view is protected by construction:
the document loop creates every URI from that same entries array. No numeric
health score is reported because telemetry/scoring was disabled.

Impeccable's source detector found no findings in the reviewed shell/palette.
Rendered Inspector review used the optimized local build at 1280×720 in light
and Daikonic themes; the namespace appeared and the viewport did not overflow.
The existing control/picker browser checks cover both themes, keyboard focus,
spacing, and Axe assertions, including 800px and 390px where applicable.
This is Chromium evidence, not physical-device or deployed-production approval.

The first optimized review replay passed all 14 cases: both J23 Settings themes,
four compact form-spacing cases, four specialized picker cases, stalled-restore
navigation/cancellation, nested Compose edits, ordinary function selection, and
HD namespace search beyond the virtual viewport. Inspector hot reload passed
locally at 97ms and 1,192ms with its unchanged two-second budget. Final validation
after the expansion-state refinement is recorded in the review session/artifacts.
Evidence is under ignored `dist/pr712-review/`; no source/token payloads are
included in this document. CI remains required before merge.

## AFB fixture bootstrap on `b0b161f0`

CI 43964382779 passed Inspector hot reload and candidate shards 2 and 4. Shard 3
passed 39 cases and failed the desktop AFB case before calculation: its temporary
one-line namespace upload still had an outstanding `/api/parse` request when the
default five-second visibility assertion expired. The screenshot reports
“Parsing files…”; the trace has no completed response, exception or evidence of
a stuck post-parse visibility gate. This is not an AFB calculation failure.

The implementation-project helper immediately unloads that temporary workspace
and installs the complete fixture. Its bootstrap barrier now verifies the exact
persisted file bytes within the same five-second deadline instead of waiting for
a semantic parse that will be discarded. The ordinary full-project restore,
published implementation resolution, Execute readiness and numerical output
assertions remain unchanged. No parser or calculation timeout was raised.

The desktop AFB case deliberately holds only the bootstrap request, observes the
honest pending status, and verifies automatic cancellation when fixture seeding
unloads the app. The real restored project still executes and returns the
expected 0.9972677595 fraction; its requests are not fulfilled with mocked parse
or calculation responses. This adversarial case failed at the original setup
barrier before the change and passed afterward. Evidence is under ignored
`dist/pr712-afb/`. The hosted request's latency remains a separate unresolved
service/performance question, not something this fixture fix claims to improve.
All 31 optimized native-implementation browser cases passed after the correction,
including the held-request desktop AFB case, ordinary mobile AFB, calendars,
schedule/frequency adapters, market observations, overrides and decimal rounding.

## Remaining readiness and hidden-layout failures on `3b27039e`

CI 43968197226 passed AFB, hot reload, lint/test/coverage and candidate shards 2
and 4. Three failures remained. J11 uploaded a three-file scratch set of roughly
4,000 source characters; its hosted parse was still pending when the 20-second
readiness assertion expired. J16 observed the launcher between New workspace's
click and its asynchronous save barrier completing, skipped explicit navigation,
then lost the launcher when activation selected Explore. The code-reading case
visited Settings during preparation; the retained hidden workbench let automatic
Preview yielding consume invisible geometry and collapse the Code panel.

The corrections address those causes without changing timing budgets. Small
standalone workspaces reuse the existing parser worker, bounded to eight files
and 65,536 source characters. Curated, serialized and hydration requests stay
hosted; boundary tests cover each exclusion. Worker waits support cancellation
without triggering a second parse. The shared Core batch hydrator reconstructs
UI models for both transport paths, preserving containers, references, canonical
document identities and captured source bytes. The worker uses the same
namespace dependency collector and closure as the hosted parser. Tests cover
transitive dependencies and live Builder scope/parent identity.

Workspace activation now checks that the navigation-store snapshot has not
changed during the save barrier before choosing its default destination. An
explicit launcher selection is always recorded even when the launcher happens
to be visible already. Preview auto-collapse ignores hidden perspectives.
The code-reading regression deliberately holds parser-worker startup while
Settings is active, then completes preparation before returning to Explore.

Local testing caught a parentless worker-snapshot integration error in Prototype
before delivery; the shared batch hydration above fixes the contract rather than
masking the UI exception. The desktop AFB case now blocks any hosted bootstrap
request and verifies that standalone preparation completes without it; the
larger restored-source case separately retains held-request cancellation coverage.
The initial focused replay passed J11 (36 seconds), J16 (7 seconds), code reading
and large-request cancellation. Full Studio tests passed 2,768 cases (two skipped)
before final transport-lifecycle verification. Final expanded browser evidence
and scanner reports are retained under ignored `dist/pr712-followup/`.

These changes remove an unnecessary hosted dependency for bounded standalone
editing. They do not explain Cloudflare's previously observed tail latency or
prove CI ready before the new head's complete checks and review have finished.

The final optimized replay passed all 51 selected browser cases with no retries:
J05/J09/J11/J16/J20, all 31 native implementation cases, launcher/code reading,
large-request cancellation, and all Compose editing/execution cases. Recorded
timings had no budget overruns: J9 curated form 1,432ms, scratch form 135ms, J20
warm source 3,771ms. The deterministic early-Settings/code reading case passed
in 2.2 seconds; this establishes the local hidden-layout regression check, not
deployed or CI performance. React Doctor reported no new errors and the existing
PerspectiveHost complexity warning. No timing budgets or retries were changed.
Final verification also passed all 2,768 Studio tests (two skipped), types, scoped
lint/format and both Inspector hot-reload cases within the two-second bound.

## Follow-up on `b53ee760` CI and review

CI 44003089331 passed lint/test, coverage, accessibility/hot reload, generated
output, Python projections, fixture diff and license checks. Candidate shards
1–3 failed on curated read-only function readiness, gas-example validation after
reload, and the Code tab after an early Settings visit. J09 also exceeded its
unchanged five-second form budget (6,226ms). The page traces reported no client
exceptions. These remain failures, even where a local replay passes.

Review identified two transport identity defects. Hosted user documents now
hydrate under the URI encoded in their serialized model, retaining cross-file
annotation and inheritance pointers. Small-worker diagnostics map back to the
captured workspace paths. Regression tests check actual reference identity in
both document orders and syntax errors on relative, nested and absolute paths.

Ignoring hidden measurements alone did not protect Dockview's own geometry.
Inactive Explore now retains a measurable absolute slot, hidden and inert;
automatic Preview yielding excludes visibility-hidden perspectives. The
held-worker regression asserts those dimensions before returning from Settings.

The async cache also allowed duplicate compilation while the first request was
pending: a regression test reproduced two validator compilations for concurrent
requests. Computations now share a promise for the same target, semantic version
and variant, while data and diagnostics remain per request. Export selections
and concrete input types remain distinct. Rejected work is evicted, explicit
regeneration detaches pending work, and older versions cannot overwrite newer
results. Managed source-view arrivals retain program caches without relaxing
source-byte or projection-revision guards; changed program captures replace them.

The first complete Studio verification passed 2,775 tests, with two skipped.
Types, scoped lint/format and the optimized build passed. Mechanical Impeccable
detection found no issues in the changed React layout files. The complete
optimized candidate replay passed all 166 browser cases without retries or timing
overruns (21.7 minutes), including all previously failed cases. J09 took 1,469ms
locally for the curated form and 142ms for scratch; these are local measurements,
not evidence that CI's 6,226ms tail is resolved. The new Code-reading capture
retains the expanded Preview panel after Settings. Evidence lives under ignored
`dist/pr712-b53/`; fresh current-head CI and review remain the merge gate.
Both Inspector hot-reload checks passed within the unchanged two-second bound
(1,116ms for the delayed case), without reloading the document. No budgets or
retries were increased.
