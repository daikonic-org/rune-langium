# Selected-object editor and projection follow-ups

The October 14 production checkout used master `76c4956e` and canonical deployment
`707224d8-e39f-43fd-bbce-a97c1190a624`. Its evidence review remains unchanged under
`dist/prod-ux-2026-10-14T17-09-56Z/REVIEW.md`. This change responds to subsequent
browser annotations; its validation is local, not another production checkout.

## Source coordinates

The published `cdm.event.common` artifact for immutable cohort
`2026-09-13-45e60b7a2463` contains stale offsets for `AdjustedValuationDates`:
serialized implementation `10105..10403`, actual original source `10093..10395`.
The stale slice clips the start and includes `func R` from the next declaration.
This also caused the worker's correctly enforced source-boundary check to reject
an otherwise valid projection.

Studio parses the original readonly source through its existing parser service
before binding the expression editor. The worker verifies that source boundary,
then maps declaration identity and condition kind/index onto the linked model's
internal projection coordinates. It does not trim declaration prefixes, ignore
boundary failures, or substitute unlinked models for code generation. Synthetic
whitespace drift tests cover both languages, functions, conditions and rejected
cross-declaration ranges.

## Inspector and preview

- Function implementations fill the available main section above item details;
  Expand imposes its own minimum height rather than being neutralized by flex.
- The Implementation tab remains; the duplicate caption below it is removed.
- Doc and Meta combine as Details. Child annotations use canonical selected-node
  metadata for readonly and inherited inspection rather than parent form values.
- Documentation can resize/scroll, including readonly inspection. Comments remain
  source-only. Preview form controls and labels use the smaller shared text token.
- Code preview resolves the selected authored or curated declaration through the
  canonical export closure after hydration and worker publication. Results are
  guarded by request identity and source version. The active preview action uses
  a regeneration icon and bypasses the cached result on explicit retry. Code preview retains only one cached selection per output target, avoiding accumulation across visited declarations. The displayed document remains during regeneration, and
  refreshed text uses the same minimal-change utility as Source.
- Choosing the selected output file does not replay consumed navigation highlights
  or override a manual dependency-file choice.
- Operation owners record Activity/Output, optionally displaying a notification.
  Toast appearance/dismissal do not create TOAST history entries. Shared operation
  feedback retains correlation IDs and duration fields.

## Typed object projections

TypeScript display bodies assume validated, purpose-built Rune objects, as agreed
with the user. They do not redefine the executable JSON API contract.

| Rune operation | Displayed TypeScript |
| --- | --- |
| Scalar/enum equality | Native comparison; resolved enum members such as `AssetClassEnum.Security` |
| Required object equality | `left.equals(right)` |
| Optional object equality | Null checks before the method call; operands evaluated once |
| Object or collection compared with empty | Shared native presence test |
| Scalar choice narrowing followed by absence | `!isCash(data.underlier)` |
| Collection choice selection | `.filter(isInterestRatePayout)` |
| Collection choice presence | `.some(isInterestRatePayout)` |
| Simple enum return dispatch | `switch` with returning cases |
| Function call | Ordinary positional call without argument-assertion wrappers |
| Output accumulator | Inferred local without `RuneFuncData` or builder casts |

Enum member rendering is shared by resolved symbol/feature references and switch cases; ordinary string literals remain strings. Named guards reuse linked type-selection resolution. Metadata-wrapped selections
retain their distinct handling. Collection equality reuses the authoritative
broadcasting, empty and positional comparison source with a method predicate;
recursive `valueKey` equality is not substituted into the display. Equality is
never invoked on an absent operand. Executable APIs retain required argument,
assignment and output checks, metadata handling and constructor safeguards.

## Validation

Logs and local browser screenshots are saved under
`dist/selected-object-polish/`. Broad package tests, strict pinned corpus
compilation, workspace types, lint/format and the combined selected-object browser
journey cover the shared seams. Production J10/J19 expectations now use positional
parameter names; J11 verifies curated selected-object previews and regeneration;
J16 verifies caller-owned operation history without TOAST lifecycle entries.
Those production journeys were updated but not rerun during this remediation.

The local network LSP journey is skipped without a local LSP server. The existing
Changesets private-dependency release configuration is tracked separately in #594.

Verified local results for this branch:

| Check | Result |
| --- | --- |
| `PYTHON_BINARY=/Users/pmouli/.local/bin/python3.14 pnpm --filter @rune-langium/codegen exec vitest run --maxWorkers=2` | 2,320 pass; one skip, eight todo |
| `pnpm --filter @rune-langium/studio exec vitest run --maxWorkers=2` | 1,991 pass; two skip |
| `pnpm --filter @rune-langium/visual-editor test` | 1,663 pass |
| Post-enum worker/expression checks | 68 pass |
| Post-regeneration worker/provider checks | 119 pass |
| `pnpm run verify:codegen-corpus` | 132 pinned TypeScript files compile strictly |
| `pnpm run type-check` | Full workspace pass |
| `pnpm --filter @rune-langium/studio build` | Pass |
| Changed-file oxlint/oxfmt; Studio app.css stylelint | Pass |
| Expression workspace, inspector details, combined polish browser journeys | 17 distinct passes; one network-LSP skip |

Earlier concurrent runs hit existing five-second fixture and 120-second corpus
time limits. Isolated runs at reduced parallelism passed without changing their
budgets. An initial default-Python run used the machine's unsupported Python 3.9;
the verified codegen result uses Python 3.14 explicitly.

## CI follow-up: late LSP diagnostics

The first PR #607 lint-and-test run (`38618638579`) passed all 74 LSP assertions
but failed with an unhandled `WebSocket is not connected` rejection from diagnostic
publication after a CLI test closed its client. The adapter's preflight
`server.isListening()` check could remain true during the transport-close race.

Typed, generic and console notifications now share a send boundary that handles
only the pinned SDK's terminal-disconnect errors, including rejection after sending
starts. Unrelated failures still reject. Regression tests cover both public send
surfaces, late logging, and preservation of genuine errors.

## First review follow-ups

PR threads `PRRT_kwDORLopOc6seJEz` and `PRRT_kwDORLopOc6seJE7` identified
redundant selected-preview file publication and duplicated reconnect history.
Selected generation now uses the readiness operation's existing worker receipt;
only unselected generation synchronizes directly. Reconnect failures use one
shared feedback call retaining their original operation ID and duration.
Behavioral tests count one publication per open/retry and one correlated failure
in each history.

The two provider regressions both fail against the first PR head and pass with
these fixes. The four affected worker/provider suites pass 101 tests. All 78 LSP
tests and the full workspace type check pass after the disconnect fix; its two
delayed-send regressions also fail against the original adapter and pass with the
shared send boundary. Logs are saved under `dist/selected-object-polish/`.

## Enum value review follow-up

Thread `PRRT_kwDORLopOc6sezhG` found that enum-member projections referenced a
runtime object absent from emitted TypeScript. The emitter now exports that
object alongside its existing string-union type, and the legacy Values array
reads its values from the object. A strict compilation and execution regression
uses the real emitted module, including inherited and empty enums, rather than a
mock enum object. The regression reproduces the missing-value compiler error
before the fix.

All three TypeScript layouts compile and execute the real enum-value regression,
including `__proto__` members and runtime-reserved enum names. The latter uses
the existing TypeScript reserved-name set and shared declaration allocator;
Python naming is unchanged. The annotation enum golden is regenerated through
the built emitter, and the constructor test restricts its no-cast check to enum
literal expressions rather than rejecting the enum declaration's const object.

Final follow-up validation: all 2,323 codegen tests pass (one existing skip, eight
todo) with Python 3.14 and two workers; all 67 Studio codegen worker tests pass;
all 132 pinned generated TypeScript files compile strictly after the rebuild.
Changed-source lint and formatting pass.

## Second review follow-ups

Threads `PRRT_kwDORLopOc6shOUg` and `PRRT_kwDORLopOc6shOUn` identified duplicate
workspace failure history and lost stale-preview recovery after request start.
Workspace failures now record once at their owner, retaining detailed errors and
a shared operation ID; the notification effect only shows the toast.

Waiting snapshots retain previous same-target contents for recovery without
treating them as a newly generated navigation destination. Repeated retries and
stale responses retain the selected file; format switches and workspace reset
clear recovery contents. Three behavior regressions fail against the previous
head and pass after the fix. All 89 affected store, preview panel, workspace
persistence and provider tests pass.

## Third review follow-ups

Threads `PRRT_kwDORLopOc6shfzu` and `PRRT_kwDORLopOc6shfz3` found that statement
switch projections bypassed assignment cardinality and that file publication
still implicitly generated a discarded full-workspace export.

Switch branch returns now use the same value-shaping function as ordinary
assignments; collection defaults return an empty array. Strict compilation and
execution compare displayed and exported functions for scalar, collection,
optional, empty and missing branches in both output directions.

`codegen:setFiles` now only installs source and advances its version. Explicit
generation requests remain the sole export trigger. Worker tests verify zero
export calls during both file publications, one call for selected generation,
cache reuse/invalidation and preservation of the existing completion race guard.
Both review regressions fail before these fixes and pass afterward.

Validation: all 2,324 codegen tests pass with Python 3.14 (one existing skip,
eight todo), all 93 Studio worker/provider tests pass, and all 132 pinned
generated TypeScript files compile strictly after rebuilding codegen.
All 161 Studio projection/parity checks pass, including all 117 CDM reference cases.
Changed-source lint, formatting and whitespace checks pass.

## Barrel naming and CI follow-up

Thread `PRRT_kwDORLopOc6sjtMP` found that the barrel allocator did not use the
namespace emitter's TypeScript enum reservations. The shared
`TYPESCRIPT_RESERVED_NAMES` policy now supplies namespace declarations, parameter
bindings and barrel names. A strict compilation and execution regression uses
two namespaces declaring `Number` and `rune`, checking their value objects,
Values arrays and DisplayNames exports. It reproduces five conflicting exports
before the fix and passes afterward. Python naming remains unchanged.

Run `38653005820` also found an outdated EditorPage assertion that file
publication carried a generation request ID. The test now checks pure source
installation and verifies that a source edit starts no extra export, matching
the third review's explicit-generation contract. The old expectation fails
locally as well as in CI.

Final follow-up validation: all 2,325 codegen tests pass with Python 3.14 (one
existing skip, eight todo), all 1,998 Studio tests pass (two skips), and all 132
pinned generated TypeScript files compile strictly after the codegen rebuild.
Codegen source/test types and changed-file lint/format pass.

## Selection recovery and object display contract

Thread `PRRT_kwDORLopOc6sldSF` reproduced recovery of declaration A's preview
after switching to declaration B and receiving an outdated result. Request
recovery now includes workspace identity and declaration namespace/name/kind;
whole-workspace exports have their own identity. The editor clears unrelated
contents during waiting, including waiting-to-waiting selection changes, while
same-selection refreshes retain their document. Provider regressions cover
declaration, kind, selection removal and workspace transitions; a real CodeMirror
regression covers selection change during an in-flight refresh. They fail before
the fix and pass afterward.

Thread `PRRT_kwDORLopOc6sldSC` asks to align displayed object equality with
structural JSON APIs. This is intentionally outside the display contract agreed
with the user: projections assume purpose-built objects with `.equals`; exports
accept structural `RuneFuncData` and keep shared structural equality. Neither
contract is changed by copying a projection into an exported function. Existing
projection execution tests supply purpose-built objects and verify that absent
operands never invoke equality; executable equality tests exercise plain objects.

Selection follow-up validation: all 2,004 Studio tests pass (two existing skips),
including 59 store/provider/real-editor checks. Changed-source lint/format passes.

## Switch metadata and hydration failure follow-ups

Threads `PRRT_kwDORLopOc6slnFS` and `PRRT_kwDORLopOc6slnFY` identified a
parallel statement-switch context and another duplicated hydration failure.
`renderTranspiledSwitch` now owns both expression and statement branch bindings,
including the original metadata selector, implicit metadata and Choice bindings.
The statement form binds its selector once. Strict compilation/execution checks
cover metadata passed from implicit items to typed functions, field/reference
wrappers, matched/default branches, missing/reference-only inputs and one payload
read. The linked regressions reproduce compiler errors before the fix.

The hydration rejection path now supplies its curated operation ID and duration
to the workspace-error owner. That helper records once and retains the normal
state/notification update. A rejected hydration regression observes one terminal
entry in each history with the original correlation, the graph preserved and the
namespace retryable; the previous code produces two failures.

Follow-up validation: 2,327 codegen tests pass with Python 3.14 (one skip,
eight todo), 2,005 Studio tests pass (two skips), 161 projection/parity checks
pass including all 117 CDM cases, and all 132 pinned TypeScript files compile
strictly after rebuilding codegen. Codegen source/test types and changed-file
lint/format pass. The first broad Studio run exposed a test waiting for its
container before CodeMirror mounted; it now waits for the actual editor view
with the same timeout and readonly assertion. The full rerun passes.

## Refreshed readonly source

Thread `PRRT_kwDORLopOc6sl2O4` found that a failed replacement coordinate parse
left an older readonly binding visible. Replacement parsing now clears prior
bindings and parse state. The active/display predicates also require the parsed
source and captured binding to match current readonly content, so neither Rune
nor cached projections show the prior body while parsing or after failure.
Rejected parse promises use the same failure state. Editable draft recovery is
unchanged. Four before/after regressions cover invalid/rejected replacements in
Rune/TypeScript and restoration of valid source. The curated-coordinate fixture
now publishes its source to the canonical document owner as the real host does.

Readonly follow-up validation: all 2,009 Studio tests pass (two existing skips),
including all 28 expression-workspace tests; changed-file lint/format and
whitespace checks pass. Codegen remains unchanged from its 2,327-test and
132-file strict corpus validation.

## Missing selected source and warning outcomes

Threads `PRRT_kwDORLopOc6smEaD` and `PRRT_kwDORLopOc6smEaK` found two
remaining recovery/reporting issues. The worker now consumes the shared export
resolver's unknown declarations/namespaces before generation. Invalid selected
source therefore posts `codegen:outdated`, preserving the last same-selection
preview rather than replacing it with an empty or partial export. The source
version guard also suppresses obsolete selection failures. Invalid unrelated
files remain filtered without blocking a valid selection.

Operation warning records retain warning severity in Output and now carry an
unsuccessful Activity outcome. Info/success and error behavior are unchanged.
Four regressions fail before the fixes and pass afterward; all 76 focused
worker/operation tests pass.

Final follow-up validation: all 2,016 Studio tests pass (two existing skips),
Studio application/functions types and scoped lint/format pass. Codegen is
unchanged from the prior 2,327-test and 132-file strict corpus checks.
