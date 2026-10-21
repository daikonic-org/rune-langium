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
pre-cleanup HEAD. A legacy Graph browser journey also has baseline setup/visibility failures:
Focus-off shows only standard-library nodes in both the changed checkout and an
unchanged checkout. Its test file was left unchanged; full Graph browser
acceptance is not claimed.

## Bundle comparison

Fresh isolated Vite builds, uncompressed bytes for the main index artifacts:

| Artifact | Before | After | Saved |
| --- | ---: | ---: | ---: |
| JavaScript | 7,856,704 | 7,834,235 | 22,469 |
| CSS | 413,180 | 404,342 | 8,838 |
| Source map | 26,783,397 | 26,608,933 | 174,464 |

The source map still exceeds Pages' 25 MiB per-file limit (26,214,400 bytes).
This cleanup does not resolve that existing packaging blocker. Builds and logs
are isolated under `/tmp/rune-cleanup-*`; the earlier production UX evidence and
owner checkouts were preserved. No deployment was performed.
