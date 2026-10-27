# Production UX checkout — 2026-10-27

Audited the deployed Studio at master `838236925624da136515d4e6c7d0dad3fe48d94f`.
Cloudflare canonical deployment `92abd5dc-4614-4ec6-b362-b6f135ce56f2`
completed successfully at 01:28:53Z. Master CI and endpoint verification passed.

## Result

Across the baseline and focused reruns, 60 desktop cases produced 58 passes,
one product failure and one harness freshness block. The freshness block reflects
missing shell credentials; the read-only Cloudflare connector independently verified
the exact deployed master commit. This was not one uninterrupted green suite.
The review included manifests, retry traces, operation logs, raw axe results and
138 checkpoint screenshots, followed by the focused rerun screenshots.

The Code-tab download dialog omits `cdm.base.datetime` after previewing and
regenerating `BusinessCenters`. Both attempts list only local/system namespaces.
J11 stays red. Export perspective generation/download of the same reference works.
The dialog's namespace list comes from the legacy parse dependency graph rather
than the accepted project-reference closure; a fix should reuse the authoritative
project/reference snapshot for both options and the download request.

A user reported a crash after adding a reference to a blank workspace. An existing
long-lived tab logged Dockview layout deserialization failure while running the
older `index-CyY92xo1.js` bundle; fresh production served `index-D98y439f.js`.
The exact report is not claimed fixed. New-workspace CDM Nightly and pinned 7.8.0
journeys, including a saved Explore layout and reload, passed twice with the current
bundle. Existing user tabs and unsaved work were left untouched.

Passing runs also recorded 342–1,227ms long-task warnings in Settings and transient
example-type-unavailable warnings during successful example restore. These remain
UX/performance observations for follow-up, not silently accepted known issues.

## Added coverage and harness repairs

- J23: real workspace YAML save/readback, comments/unknown-field preservation,
  original filename, navigation, validation and both themes.
- J24: independent named SQL targets/drafts, Generate target/all, external edits,
  dirty removed-target guards, reload and generated-file retention.
- J25: Rune JSON metadata/header persistence and restored Choice controls used
  as executable workflow inputs.
- J26: renamed-workspace selection, settings/target isolation and reload.
- J27: failed decoding retains original payload bytes, refuses unsafe Retry and
  recovers after explicit repair/reload.
- J28: add Nightly/tagged references to a blank workspace, return to Explore with
  an existing layout, and reopen without a page error.

Local and production wrappers share the same complete journey implementations.
Smoke/UX CDM setup now uses the actual reference review/Save transaction. The
reference graph readiness and cancellation checks follow this transaction rather
than the removed legacy loader. The cache check compares the full CodeMirror
document and proves pinned artifact requests are reused across reload.

J17 now sweeps dark and light themes; its fixed-dark-theme exception was removed.
Both sweeps passed with zero serious/critical findings under the existing widget
exclusions. One nested phone step escaped an initial title filter; its result was
excluded and the production wrapper now explicitly supports a desktop-only flag for phone cases
and nested phone steps. Default full-suite coverage is retained. The affected workflow cases passed again on desktop.

The small prototype smoke now uses Add and checks immediate no-transform output
plus saved-payload isolation. Its old form/Inspector assumptions were stale;
intermediate attempts also incorrectly expected automatic example writes and an
Execute button without a transform. The corrected smoke passed against production.

## Validation

- All nine added J23–J28 cases passed together against production in 1.2 minutes.
- Existing harness unit tests: 26 passed.
- Refreshed prototype smoke: one passed in 2.7 seconds, separately from the 60-case review.
- Scoped lint, formatting, diff checks and Studio source/functions type checks passed.
- Existing timeouts, retry counts, test selection criteria and coverage thresholds
  were not relaxed to hide failures. This checkout used desktop scope; `PROD_UX_DESKTOP_ONLY=1` selects it for future runs.
- No application source patch, manual deployment/publication, completed OAuth
  authorization, user-tab reload or user-workspace deletion was performed.

The detailed local `REVIEW.md`, case-by-case composite manifest, screenshots,
traces, axe JSON, endpoint log and rerun logs form the evidence bundle. Initial
harness failures and superseded attempts remain available there. No browser
credentials were copied into the test environment.
