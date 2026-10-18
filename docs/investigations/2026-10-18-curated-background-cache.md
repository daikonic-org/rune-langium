# Background curated caching and progressive hydration

Related: [#545](https://github.com/pradeepmouli/rune-langium/issues/545),
[#582](https://github.com/pradeepmouli/rune-langium/issues/582),
[#540](https://github.com/pradeepmouli/rune-langium/issues/540).

## Observed persistent-cache behavior

Three isolated Chromium contexts against the hosted Studio on October 18 at
approximately 22:08 UTC selected `cdm.base.datetime.BusinessCenters`, opened its
original source, reloaded the same page, and reopened its form/source. Cold
selection took 3,187 / 3,729 / 5,261 ms. Entire reload-to-form took 2,199 / 2,086 /
2,071 ms. All reloads reused 44 document-artifact records and one source record;
selected hydration returned zero curated documents and no source was refetched.
The selected parse response transferred about 2.96 MB cold and 33.5 KB warm.
All six screenshots showed form fields and original source; no page errors.

These start points describe different workflows: cold selection begins after
catalog loading, while reload includes application restoration and may start
selection restoration before the explicit click. There is no controlled
percentage speedup claim. The served URL's canonical deployment SHA was not
independently verified, and three samples do not characterize the slow tail.
The initial probe's incorrect `Business Centers` field locator was corrected to
the actual `Add Business Center item` action; that locator failure is excluded.
Raw evidence remains under ignored
`dist/curated-stage-probe/second-load-2026-10-18T22-08-14-716Z/`.

## Implemented boundary

The existing server manifest resolver supplies a metadata-only seed list with
bundle, cohort version, namespace and exact immutable artifact identity. No
client-side closure approximation or second manifest selection is introduced.
The cache client starts a SharedWorker lazily, with a dedicated-worker fallback.
Background loading runs after a quiet interval, one namespace at a time; it
does not hydrate documents into the workspace. Metadata validation strips extra
properties and rejects mutable identities and mismatched bundle/namespace keys.

The worker uses the existing namespace fetcher, gzip/schema validation and
canonical hydration transport. Separate in-memory response retention is disabled
for speculative downloads. Each payload and receipt use the existing atomic
IndexedDB transaction, byte/record budgets and format version. Background writes
stop instead of evicting foreground records. Storage failures do not prevent
normal loading. Source text remains independently lazy.

Foreground parse/source work interrupts prefetch and renews a bounded pause
lease shared across tabs. Closing/suspending a tab releases its queue ownership;
an abandoned lease expires. Replaced cohorts retain their own immutable keys;
the server still authorizes the active dependency closure. Seeding is skipped
when the browser reports data-saving or slow-2G mode. The fallback retains
correctness but cannot guarantee cross-tab download deduplication.

## Why progressive hydration is still useful

Seeding can turn a later first selection into an artifact-cache hit. It does not
remove the current server round trips, cached JSON restoration, worker setup,
linking, graph adaptation or form preparation. The measured warm reload still
takes about two seconds, including application restoration.

Progressive hydration would target time to useful Inspector content: show the
selected declaration's header and member rows as soon as their canonical model
is ready, while preparing dependent forms/projections afterward. Full semantic
operations must still wait for their authoritative closure; unresolved work
must not be presented as a successful empty model or approximated AST. Scope,
inheritance, selected source identity and late-result/workspace guards remain
required. This change does not implement that consumer split, establish its
speedup, or satisfy #545's first-content latency criteria.

## Validation scope

Unit checks exercise cache non-eviction across connections, byte limits, identity
validation, cross-tab job deduplication, interruption/retry, abandoned holds,
cohort changes, data-saving mode, fallback and disposal. Pages tests establish
that seed metadata is cohort-pinned without fetching documents. Workspace tests
verify that user source never enters seed messages and holds release on failure.

The browser regression exercises the actual SharedWorker and dedicated fallback,
real IndexedDB, two tabs, reload reuse and foreground hydration consuming only
the preseeded payload. The existing cache suite still covers original source,
cross-namespace linking, missing payloads and corrupt deferred JSON recovery.
These are correctness checks, not a production latency acceptance or proof that
the historical 30-second incident is resolved.

Local validation passed: 2,052 Studio tests across 221 files (two existing skips),
nine Chromium cache journeys, full workspace types, strict compilation of the
new test files, scoped lint/format and the Studio production build. The new
worker is emitted as a separate lazy asset (approximately 149 kB uncompressed).
The existing build warnings about tree-sitter eval and mixed dynamic/static
imports remain. The unchanged root coverage corpus test's 60-second timeout,
observed in #613/#614, is separate CI maintenance.
