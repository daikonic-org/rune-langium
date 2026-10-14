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
