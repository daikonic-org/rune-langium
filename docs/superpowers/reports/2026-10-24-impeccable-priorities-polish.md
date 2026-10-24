# Studio priorities and polish

Implemented in `codex/workspace-launcher-design`, following the accepted October 24 Impeccable critique. All five priorities and the three UI polish items are addressed locally. No push, PR, merge or deployment was performed.

## Changes

- Named workflows compare the canonical portable recipe, show **Unsaved changes**, and recover per-recipe drafts when switching. The Save baseline is the exact captured recipe, preserving edits made during an asynchronous Save. Drafts are private to the mounted workspace session, not reload recovery.
- Shared design-system Buttons explicitly paint a solid focus outline. Keyboard browser checks verify `:focus-visible`, solid style and 2px width after compilation.
- Shared Preview/Prototype numeric controls use neutral Required guidance before interaction and friendly worker number-type errors afterward. Domain messages, precise decimal strings, canonical validity and Execute gates are preserved. Blur forwards its event so list transactions do not validate twice.
- Recent workspaces distinguish Browser only / No Git remote and offer inline Rename. One IndexedDB transaction updates only the latest display metadata and recents; active App state updates without activating a different workspace. Rename never changes model identity or source files.
- Catalog failures live beside the selected reference model's Retry action. Technical HTTP detail is disclosed on demand; unchanged-reference reassurance applies to this read-only operation, not Save failures.
- Mobile controls reserve 44px targets, including composed validation popovers. Recent names/status have a readable column beside actions. Desktop density remains compact.
- Recipe Save can retain a labeled previous result while schemas/receipts refresh. It remains display-only; stale output cannot seed a current example or payload graph.
- The empty example table explains JSON reuse; filtered emptiness offers Clear filters.

## Verification

- `pnpm --filter @rune-langium/studio test`: **2,354 passed, 2 existing skips**, 254 files.
- `pnpm run type-check`: all workspace packages passed.
- `pnpm --filter @rune-langium/studio run build`: passed.
- Scoped Oxlint, Oxfmt, Stylelint and `git diff --check`: passed.
- Chromium against owned Vite 5204: **13 distinct journeys passed**, across the portable workflow, launcher and Impeccable suites. Checked 1440/700/390px layouts, axe scans, validation/execution, previous-result safety, canonical draft recovery/revert, rename/reload, 44px targets, readable mobile names, real keyboard focus and catalog HTTP 503/Retry recovery. Screenshots were inspected; browser bounds alone initially missed clipped mobile names, now fixed and regression-checked.
- Manual scoped Impeccable detector: **zero findings** across eight TSX files. This is supplemental evidence, not proof of visual quality.
- Owner guidance diff SHA256 remains `8c1d2111114c21a0ab8d5b7e351faea433f9eea6423d0364e9fd32251e81ad20`; owner resources and other checkouts/processes were preserved.

## Limits

The optional `.design-sync/build.mjs` attempt built design-system TypeScript but cannot package the external design bundle: this checkout lacks `.ds-sync/node_modules/.bin/tailwindcss` and the staged converter. Runtime Studio compilation and browser CSS passed independently. No design bundle publication is claimed. Live Git services, production deployment, full screen-reader behavior and successful production reference release selection were not part of this pass.
