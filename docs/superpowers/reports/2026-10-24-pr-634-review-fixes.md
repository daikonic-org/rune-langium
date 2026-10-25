# PR 634 review and CI corrections

## Named builds after source autosave

The current-head review identified a valid P2: after a source edit had reached the working copy, Build selected/all still captured the old ProjectController snapshot and correctly failed the runtime `PROJECT_STALE` check.

The regression first reproduced both actions in Chromium. Export now flushes registered editor/source Save, reloads the active controller, and waits for the existing WorkspaceProvider runtime capture to match that saved revision before starting a named build. No parallel reference resolution or receipt builder was added. Cancellation, workspace transitions, source edits during preparation and failed Save prevent the build. Runtime freshness checks during generation remain intact; a regression verifies changed source prevents output writes.

## Original-head CI failures

- Accessibility: update the retired Browser test label to Browser only. Include the visible shortcut hint in the global search button's accessible name, preserving its existing keyboard shortcut and visual caption. The complete axe gate passes with no rule exclusions added.
- Hermetic notifications: wait for the actual dismissed toast root to detach rather than require the total notice count to drop by one while another notice can arrive. The helper still clicks the real dismiss control and fails when that root stays mounted.
- Runtime integration: split override execution/required-input validation and removal/fallback into independent tests. Both still compile generated code and use canonical input validation. The default five-second timeout and all assertions remain unchanged.

## Verification

- `PYTHON_BINARY=/opt/homebrew/bin/python3.14 pnpm run test`: passed, **7,307 Vitest tests** across 18 package runs, including Studio **2,360 passed / two existing skips** and runtime **77 passed**. Pages packaging tests also passed. Existing skips/todos remain.
- Seven unretried Chromium journeys passed against owned Vite 5204: all three Studio accessibility checks plus named targets, compact controls, and both edit/autosave/build actions.
- Focused Export/preparation/freshness suite: **31 passed**.
- Studio type checking, production build, scoped Oxlint/Oxfmt and diff checks passed. Normal commit/push hooks remain enabled.
- Original reviewer thread: `PRRT_kwDORLopOc6v5bEj`; [comment](https://github.com/pradeepmouli/rune-langium/pull/634#discussion_r4367576182).

No merge, deployment, reference publication, timeout increase, retry increase or validation bypass is included. Owner guidance, resources, evidence, other checkouts and existing processes remain preserved.


## Second review: reviewed-input binding and dependency traversal

- Reference preparation now refreshes the saved working copy after pending editor/source Save. The picker applies its release selection to that fresh build configuration, preserving target settings written outside its cached view. Preparing its own refresh does not cancel the proposal; later controller changes still invalidate a reviewed proposal.
- Review records the complete original file list and raw byte revisions for every non-destination input. Acceptance passes those into the existing Save transaction; configuration/lock writes keep their own CAS checks. Silent source/resource edits, additions or removals reject acceptance without replacing the lock. Shared draft-snapshot capture preserves untouched binary identities.
- Browser and native adapters share `isIgnoredProjectEntry` from project-config and prune `.git`, `.studio` and `node_modules` at any depth before enumerating children. A throwing dependency iterator proves that the browser never descends into installed dependencies.
- The runtime fixture now compiles the generated function, canonical Zod input schema and a tiny export bridge in one strict TypeScript program. It still checks generated types and actual required-input/runtime behavior. No type-check flag, timeout, retry or concurrency limit was relaxed. A fresh local process measured the first fixture at 533ms; CI remains the authority for hosted timing.
- The browser batch exposed toast expiry during click stabilization; the helper ignores a click failure only after proving that exact root detached. A deterministic animation/expiry journey covers the race. The selected starter description also needed its own foreground treatment to maintain contrast after its background animation settled; the axe rule remains enabled.

Targeted regressions first reproduced six failures. The repaired service/adapter/picker suite passed; the final parallel workspace run passed **7,325 Vitest tests plus five Pages tests**, including Studio **2,370 tests** with two existing skips, project-config **118 tests**, and runtime **77 tests**. Eleven distinct unretried browser journeys passed across reference/clone/target/a11y cases, including both 1440px and 390px reference journeys. Studio production build, scoped lint/format, CSS lint and diff checks passed. Normal pre-push verification is recorded with the pushed head in the PR. Owner guidance/resources and unrelated work remain preserved.

## Hosted-runner fixture setup

The subsequent hosted run still timed out its first implementation case at 5.6 seconds. The suite now captures its shared locked reference fixture once in `beforeAll`, rather than reconstructing identical artifacts, resolution and input snapshots in each scenario. Tests continue to build separate effective graphs and strict TypeScript programs, including the project reopened from disk. Override-removal edits a copied file map. No timeout, retry or compilation assertion changed.

All **77 runtime tests** passed after this adjustment. The same four implementation cases also passed under the root configuration used by coverage; its first scenario took 361ms locally. Scoped lint, format and diff checks passed. Hosted CI and review must confirm the pushed revision before merge.

## Coverage native-binding fixture

Hosted package tests then passed. Root coverage exposed a separate first-case timeout in the native binding layout matrix: per-namespace took 5,198ms, while barrel and single-file took about three seconds. Parser/compiler dependencies now load with the test module, and the native matrix parses its common Rune fixture once in a describe-scoped `beforeAll`. Every layout still generates and strictly compiles a separate module, verifies native invocation and rejects rebinding. No timeout, retry, coverage threshold or assertion was relaxed.

All nine focused binding tests passed. The complete unchanged root coverage command also passed: **3,128 tests**, one existing skip and eight todos, across 267 files, including all three layout cases and the repository's existing coverage thresholds. Coverage was 55.72% statements, 61.40% branches, 37.79% functions and 57.18% lines. Fresh hosted CI and review are required for this revision before merge.

## Public CLI/LSP runtime dependencies

The next review identified private workspace libraries in the public CLI/LSP
runtime dependency closure. Project-config, project-runtime, curated-schema and
instrumentation-core now declare public scoped publication rather than private
packages. A Changeset covers those libraries and their CLI/LSP consumers. This
changes publication eligibility only; no registry publication or release dispatch
was performed, and the release workflow remains manual.

The new `scripts/package-publication.test.mjs` follows CLI/LSP workspace runtime,
optional and peer dependency edges. Both tests reproduced the private-dependency
failure before the manifest correction and now pass. Main CI runs that check.

The full nine-package closure built and packed locally. Every packed manifest
has public access, concrete versions instead of `workspace:` dependency values,
and present export/main/type/bin files. A separate temporary consumer installed
those tarballs, using registry dependencies and disabled lifecycle scripts. It
imported the packed LSP factory and ran the packed CLI's TypeScript and JSON
Schema starter builds without workspace links. Workflow YAML, scoped lint/format
and diff checks passed.

Changesets no longer reports the CLI/LSP/project or codegen instrumentation
dependency errors. Its separate pre-existing visual-editor dependency on private
design-system still prevents global release planning and remains outside this
correction; these checks do not claim full repository release readiness.
