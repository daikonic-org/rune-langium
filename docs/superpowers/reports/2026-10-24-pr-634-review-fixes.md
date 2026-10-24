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
