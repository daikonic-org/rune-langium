# Managed reference view integrity

Two P1 findings identified distinct ways a captured semantic view could lose
editable source data. Its source-glob filter removed excluded files from the
array later sent to autosave, which interpreted those omissions as deletions.
Retaining that captured array during parsing could also restore file A's old
text when a subsequent edit to file B submitted the complete array.

The shared file projection now keeps all current writable/system files and adds
only captured locked references. Source globs apply to semantic hydration, not
the editable inventory. Reference namespaces are keyed by file path instead of
assuming the complete inventory matches hydrated document indices. The hook
retains semantic models while merging current files and current workspace
metadata. It marks the view pending as soon as the writable array changes and
keeps the last valid references through parser-wait errors. Workspace identity
and abort guards remain; autosave pruning and canonical Save/CAS are unchanged.

Three regressions failed before the correction. They reproduce an actual deleted
excluded file and an actual reverted first edit through the bound-folder adapter
and normal autosave, then read the saved bytes back. They also cover live file
addition/deletion, retained references and workspace switching. The repaired
four-file focused suite passed all 32 tests, including an additional initial
failure regression with no previous view or workspace identity. That recovery
branch now explicitly requires a previous record before reading its view.

CI separately exceeded the five-second default while one Python projection test
looped over three independent metadata predicates. The test matrix now exposes
each rule-kind/predicate pair separately. All six combinations retain the same
generated source and Python/TypeScript parity assertions; no timeout, retry or
assertion was relaxed. The focused Python file passed 174 tests and the complete
codegen suite passed 2,370 tests (one existing skip, eight todos).

Final local checks passed: **2,379 Studio tests** (two existing skips), **3,132
root coverage tests** (one existing skip, eight todos), Studio production build,
scoped lint/format and diff checks. Existing coverage thresholds remain intact.
Four unretried browser journeys passed: reference selection/cache reopening at
1440px and 390px, the real reference-caller saved workflow/clone, and native-folder
Save/reopen. The owned validation server was stopped afterwards.

Normal commit and full-workspace pre-push verification are recorded with the
pushed revision in PR #633. Fresh hosted CI and review are required before merge.

Two subsequent P2 findings are also corrected. WorkspaceProvider now extends the
existing source flush action with a portable-record barrier. It waits for queued
example writes/removals and presentation saves, rechecks both streams until their
state stabilizes, and rejects retained failures or workspace changes before Git
can stage files. Existing explicit retry actions recover failed records. The
barrier follows source flushing so an edit arriving during source publication is
also included. No save transaction, CAS guard or Git synchronization policy is
replaced.

The managed extension destination and duplicate-kind check now use the same
`EXTENSION_PARENT` mapping as source generation. Choice extensions therefore
navigate to the generated Data declaration. The regression matrix compares each
supported extension destination against the parsed declaration saved through the
real project controller.

Before the fixes, four regressions failed: Choice destination identity, premature
publication during a paused payload/descriptor transaction, and publication after
settled example or presentation failures. Final integration tests also pause a
presentation transaction, queue late edits in both streams, and edit an example
while source flushing waits. They exercise the real provider, stores, repository
transactions and readback with only Git transport mocked. The five-file focused
suite passed **88 tests**; full Studio passed **2,388 tests** with two existing
skips. Studio production build, type checking, scoped lint/format and diff checks
passed. Three unretried Chromium journeys passed: Inspector Modify, Extend and
native-folder Save/reopen. Fresh hosted CI/review are required after the push.
