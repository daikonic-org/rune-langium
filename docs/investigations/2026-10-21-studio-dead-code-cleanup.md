# Studio dead-code and repository duplicate cleanup

Verified on `codex/retired-structure-cleanup`, based on `d99db6c8` (the same
committed tree as merged master `309b59d0`). This is local validation, not a
production deployment or an exhaustive claim that the repository has no clones.

## Removed and consolidated

- Removed the retired XYFlow Structure layout, renderer variants, base wrapper,
  connectors, measurement inputs, CSS and obsolete-only tests. The current nested
  DOM Structure view and live Graph renderers remain. Relevant affordance tests
  now exercise the actual DOM view rather than the removed renderer variant.
- Removed unused flat namespace helpers, synonym adapters, merged-member
  builders, history hooks and expression drag hooks. Test-only graph lookup and
  patch-generation helpers now live under tests. Strict expression serialization
  and the development design preview remain in use.
- Shared editor row reordering, cardinality parsing, inheritance parent lookup,
  message shape checks, ULID generation and Dagre graph construction. Sync,
  Worker and fallback scheduling retain their original cache/cancellation owners.
- CLI parse, validate and generate share recursive file discovery, preserving
  input order, duplicates and missing-path errors.
- Codegen import readers share identifier normalization, collision reservation
  and the matching JSON Schema/XSD namespace sanitizer. Callers retain their
  original fallback names; OpenAPI's different namespace policy remains local.
- Six emitters share type-index adaptation with explicit fallback source URIs.
  TypeScript/Zod bundles share preamble removal. Python/TypeScript lenses share
  grammar-neutral traversal/refusal helpers and separately owned grammar caches.
  The unused import-only fatal-diagnostic predicate was removed.
- Four Workers share JSON/CORS response construction in `worker-core/http`;
  origin authorization remains at the routes. The only lockfile change adds the
  existing workspace dependency to GitHub authentication. No external versions
  changed. Three archive zero-block loops now use native typed-array checks.

## Infigraph evidence and limits

Used indexed symbol context, references and transitive impact before extraction,
then refreshed the index and reran clone detection at threshold **0.92** with
the default minimum **50% token overlap**, Function/Method kinds.

| Scope | Earlier candidate pairs | Final candidate pairs |
| --- | ---: | ---: |
| Visual editor source | 23 | 4 |
| Studio source | 5 | 3 |
| CLI source | 3 | 0 |
| Whole repository, including tests/fixtures | 737 | 662 |

The whole-repository baseline was taken after the initial UI consolidation; the
UI and repository counts therefore cover different starting points. Pair counts
are not counts of defects or independent implementations. The final repository
scan scored 4,802,158 pairs across 3,134 functions/methods and returned its best
60 matches; remaining matches were not exhaustively reviewed. Raw local results
are `/tmp/rune-cleanup-clone-results.md` and
`/tmp/rune-cleanup-clone-results-expanded.md`.

Reviewed survivors include fixtures/generated golden output, empty protocol
callbacks, language-specific renderer dispatch, and helpers with distinct naming,
encoding, precedence or cache contracts. Editor forms already share their frame
and section primitives; their feature bodies differ. `hashUrl` and editor tab
identities use different signedness/output conventions. JSON Pointer and OPFS
path decoding are different codecs. Condition suffixes use `Name2`, whereas enum
identifiers use `Name_2`. Matching syntax alone does not justify merging them.

Small cross-domain SHA-256 and delay helpers remain separate: consolidating them
would require a new general utility boundary or dependencies unrelated to their
current packages. They are recorded as remaining duplication, not falsely
classified as removed. Test fixtures were not centralized merely to lower the
scan score. Whole-form and cross-language renderer redesigns remain out of scope.

## Additional non-UI dead-code pass

A follow-up Infigraph pass covered codegen, CLI, LSP server, worker-core,
curated-mirror Worker, codegen Worker, core utilities and Git synchronization.
Its raw zero-caller candidates were respectively 93, 3, 180, 2, 6, 3, 28 and 62.
These are candidate counts, not verified dead-code totals: the index also reports
callback references, interface implementations, module names and some object
properties as unreachable symbols.

Removed `emit/namespace-registry.ts::findNamespaceForSymbol` after graph context,
references and transitive impact plus a repository text search confirmed there
were no callers, tests or public re-export. Retained the CLI command handlers,
Worker entry points/logger helpers, interface-driven emitters, scalar metadata
resolver and Rosetta renderer callbacks after corroborating their use. Infigraph's
combined regex/file-pattern lookup returned no text for some known references;
direct text search was used to check that limitation. This was a bounded audit,
not an exhaustive deletion of every zero-caller result. No LSP runtime source was
changed by this cleanup.

## Verification

| Command / scope | Result |
| --- | --- |
| `pnpm --filter @rune-langium/visual-editor test` | 1,568 pass |
| `pnpm --filter @rune-langium/studio test` | 2,120 pass, 2 existing skips |
| `PYTHON_BINARY=/Users/pmouli/.local/bin/python3.14 pnpm --filter @rune-langium/codegen test` | 2,336 pass, 1 skip, 8 TODOs |
| `pnpm exec vitest run packages/cli/test packages/worker-core/test` | 30 pass |
| Four affected Worker package test scripts | 154 pass |
| Studio OPFS and instance-bundle tests | 43 pass |
| Curated source/publication Node tests | 16 pass |
| Codegen, CLI, visual-editor, Studio, worker-core and four affected Worker type checks | Pass |
| Codegen, CLI, visual-editor and worker-core builds; isolated Studio Vite build | Pass |
| Root lint, CSS lint, format check and `git diff --check` | Pass; existing lint warnings remain |
| `pnpm install --frozen-lockfile --ignore-scripts --offline` | Pass with pnpm 11.5.0 |
| Structure browser journey at 1323, 900 and 390px | 3 pass, including axe checks; screenshots inspected |
| Lean function browser journey: validation, execution and TS/Python projections | 1 pass |

The layout tests include actual Worker/fallback parity, cancellation and large
incremental placement. Generated Python runtime source did not change on build.
Visual-editor API references were regenerated through TypeDoc; generated AST,
domain and Zod schema sources were not hand-edited.

Full-workspace `pnpm run type-check` passes for cleanup commit `de889e70` in
the clean publishing verification checkout after forced affected-package builds.
The original working checkout remains blocked by the separate uncommitted edit in
`packages/lsp-server/src/model-index.ts:166` (`TextDocumentProvider.all`). The LSP
package type check passes in the unchanged verification checkout at the same
pre-cleanup HEAD.

## Follow-up Graph viewport fix

The previously recorded Graph browser failure is now resolved. The nodes were
present in the store and local Graph state; React Flow's default 50% minimum zoom
kept Fit View from including the tall graph, and viewport culling omitted the
imported types below the visible area. A 5% floor lets the graph fit without
removing culling. A second Studio selection effect also re-laid out and fitted the
whole graph immediately after the graph's own selected-node fit, overwriting
readable navigation. Removing that duplicate effect leaves camera ownership in
`RuneTypeGraph`; existing measurement safeguards remain unchanged.

The new viewport regression failed before the zoom-floor change. A separate
readable-navigation assertion failed until the redundant Studio fit was removed.
All **11 Graph interaction browser checks** then passed without retries: canonical
node rendering, inheritance edges, selection, Fit View, readable explorer
navigation, re-layout, multi-file models, attributes and panning, plus overview
fits at 900px and 390px. The 390px case uses the existing explorer/preview collapse
controls. All four final screenshots were inspected. This is local browser
coverage; a hosted LSP was not running during these journeys.

Both affected full test suites (1,568 visual-editor and 2,120 Studio tests with two
existing skips), affected-package types and root lint/CSS checks pass after the
Graph fix. Local evidence is `/tmp/rune-graph-fix-*`. Existing release configuration
and Pages source-map packaging remain separate; package release is deferred by
the user.

## Review follow-up: skills and Structure headers

Refreshed the tracked root visual-editor agent skill from the authoritative
TypeDoc/Skillit output, removing the obsolete flat function reference. All 15
files match the docs-site bundle byte for byte; removed namespace/history/synonym
exports are absent and local Markdown links resolve. The workflow now calls out
refreshing both distributed copies after public API changes. TypeDoc completed
with no errors and its existing unresolved `WebSocketTransport` link warning.

Structure headers now use one flexible gap after the title, keeping metadata
icons next to the kind badge instead of splitting free space on both sides.
Root and nested headers retain the same vertical center and an 8px icon-to-badge
gap at 1461, 900 and 390px; popovers still work. Kind pills center their
text with an explicit compact line height and equal block padding, including
the inherited-type badge. The three existing Structure
browser journeys (including axe, drag, resize and collision checks), 18 focused
component tests, visual-editor lint/CSS lint and formatting pass. Screenshots
were inspected. Local evidence is `/tmp/rune-pr627-header-*`.

## Bundle comparison

Fresh isolated Vite builds measured at `a505e067`, including the Graph follow-up
and before the small header alignment change, uncompressed bytes for the main
index artifacts:

| Artifact | Before | After | Saved |
| --- | ---: | ---: | ---: |
| JavaScript | 7,856,704 | 7,834,018 | 22,686 |
| CSS | 413,180 | 404,342 | 8,838 |
| Source map | 26,783,397 | 26,614,125 | 169,272 |

The source map still exceeds Pages' 25 MiB per-file limit (26,214,400 bytes).
This cleanup does not resolve that existing packaging blocker. Builds and logs
are isolated under `/tmp/rune-cleanup-*` and `/tmp/rune-graph-fix-*`; the earlier production UX evidence and
owner checkouts were preserved. No deployment was performed.
