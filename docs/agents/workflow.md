# Development Workflow

## Commands and Hooks

Read root and affected-package `package.json` scripts before choosing commands.
Use the pinned pnpm version and preserve overrides/patches in
`pnpm-workspace.yaml` during dependency changes.

- The pre-commit hook runs `lint-staged`, applying Oxlint fixes before formatting staged JS/TS files with oxfmt; JSON-family files are formatted directly. Formatting runs last so import rewrites cannot leave CI style drift. The pre-push hook runs type checking. Prefer the existing `simple-git-hooks` / `lint-staged` setup for hook changes.
- `SKIP_SIMPLE_GIT_HOOKS=1` bypasses hooks; report skipped verification when relevant.
- After codegen render changes, run `pnpm --filter @rune-langium/codegen run build` so consumers receive updated dist output.
- After switching stacked branches, force affected TypeScript builds with `pnpm --filter <package> exec tsc -b --force` before testing consumers. Incremental build caches can leave `dist` from the previous branch; source-only tests do not verify those exports.
- The Cloudflare combined build rebuilds `@rune-langium/instrumentation-core` and `@rune-langium/core` before bundling Studio and Pages Functions; both consumers resolve those packages through their compiled exports.
- The combined build excludes `.map` files from all public asset copies while retaining original build maps locally. Its static-output preflight rejects source maps and files above Cloudflare Pages' 25 MiB limit, and logs the largest asset. Run `pnpm --filter @rune-langium/docs test` for packaging regressions and `pnpm run build:cloudflare` for the complete artifact check.
- For temporary Pages diagnostics, set the non-secret `INSTRUMENTATION_*` values in the build environment. The combined build writes only those values to the generated root `wrangler.toml`; rebuild and redeploy to enable or remove them. Keep secrets in Cloudflare.

## Browser CI Dependencies

The `studio-a11y` job removes the runner image's priority-1 Azure HTTP entry from
`/etc/apt/apt-mirrors.txt` before Playwright installs Ubuntu dependencies. The
image's official HTTPS archive/security fallbacks and priorities remain intact;
APT signature verification and the existing test commands are unchanged. This
avoids the upstream [Azure mirror stall](https://github.com/actions/runner-images/issues/14594)
without retry loops or larger timeout budgets. The step is a no-op when the
runner has no mirror list.

## Form Dependencies

`@zod-to-form/react@0.13.0` exports the shared `SectionRenderer` used by custom Inspector layouts, from [zod-to-form PR #222](https://github.com/pradeepmouli/zod-to-form/pull/222). Use that public export directly. Keep exact core/React package declarations and workspace overrides aligned, and recheck configured Inspector sections when upgrading.

Keep Studio's explicit `Input: {}` override in its canonical form component map.
The shadcn preset alone falls back to native HTML for uncontrolled text fields;
verify the generated form imports the shared Input and renders its `data-slot`
and focus treatment. Do not replace canonical configuration validation to style
workspace settings.

Keep `@zod-to-form/vite` exactly pinned to `0.5.0` in Studio and visual-editor for the unified configuration contract. Babel 8 requires Node `^22.18.0 || >=24.11.0`; the current jsdom 30.1 test toolchain requires the higher range `^22.22.2 || ^24.15.0 || >=26.0.0`. Workspace and package engine declarations use that combined supported range. Older Node 22/24 releases and Node 23/25 are unsupported. The previous `0.4.8` plugin compatibility pin applied to the old Node 22.13 floor.

## Dependency Compatibility and Audit Exceptions

`@lspeasy/core@3.0.1` imports `type-fest` in its published declarations without declaring the dependency. The workspace package extension supplies `type-fest@5.10.0` so type checking cannot pick up an incompatible hoisted copy from another tool. [Upstream issue #307](https://github.com/pradeepmouli/lspeasy/issues/307) tracks removal after the package declares its own dependency.

`patchedDependencies` applies a nesting/AST traversal guard to every transitive `braces@3.0.3` copy used by development tooling. The patch backports only the structural guards from [upstream PR #82 at commit `1f11eb5`](https://github.com/micromatch/braces/pull/82/commits/1f11eb558be9ea0cda87861408bb766e2e714086); it does not include that PR's separate range or parent-queue changes. Parsing permits at most 128 nested brace/parenthesis containers. Recursive walkers reject child depth over 128, child cycles and more than 65,536 visits with `SyntaxError` / `ERR_BRACES_COMPLEXITY`. Shared acyclic children remain valid. Terminal nodes add an edge, so 127 parsed containers leave room for a literal leaf in subsequent traversal. These bounds do not limit Cartesian expansion cardinality or arbitrary AST property getters.

Run `node --test scripts/braces-patch.test.mjs` after install or dependency changes; CI verifies the patch through the actual Stylelint dependency. The test's optional `BRACES_TEST_PACKAGE` path allows comparison against an unpatched package without changing workspace resolution.

The audit still identifies the patched package as version 3.0.3, so `auditConfig.ignoreGhsas` remains limited to `GHSA-vfj7-8cjw-p6xm`. This version-based exception accompanies a local runtime mitigation; it does not mean npm has published a fixed release. [Issue #572](https://github.com/pradeepmouli/rune-langium/issues/572) tracks replacing the backport and removing the exception when that release is available. Use `pnpm audit --prod` to check the production tree separately.

Keep TypeScript `6.0.3` in docs and the `typescript-classic` alias in codegen: TypeDoc's peer range and codegen's compiler API need that release, while normal workspace compilation uses TypeScript 7.

The October dependency refresh uses React/React DOM `19.3.1` and Zod `4.6.7` in both manifests and workspace overrides. Mutative 2 retains the producer API but changes patch ordering and patch-value identity; verify forward/inverse replay, edit reconciliation and source synchronization when upgrading it. Camelcase 10 requires Node 22, within the existing supported range.

The October 26 dependency refresh uses react-day-picker 10 through the shared
Calendar wrapper and vscode-languageserver 11. Keep resolver 5.9.2 while
`@zod-to-form/react@0.13.0` and `@zod-to-form/vite@0.5.0` declare the resolver 5
peer range; resolver 6 needs an upstream compatibility release. TypeDoc and the
codegen compiler-API alias retain TypeScript 6.0.3, while workspace compilation
uses TypeScript 7.0.2. The root OpenTelemetry API override stays at 1.9.1 because
react-doctor's Sentry/OpenTelemetry 2.12 SDK peers exclude 1.10; remove the cap
when that dependency chain declares support. Do not suppress peer checks. Miniflare retains its scoped Undici 7 override at
7.30.1 for the HTTP parser fixes; do not force its consumers onto Undici 8.

After CodeMirror updates, run `pnpm dedupe` and check `pnpm why -r @codemirror/state @codemirror/view`. Studio and its LSP client must resolve the same state/view classes; duplicate copies make editor extensions and workspace overrides incompatible. Force affected TypeScript builds afterward to invalidate cached module resolutions.

## Production UX checkout

`pnpm --filter @rune-langium/studio run test:prod-ux` exercises the deployed Studio.
Smoke and UX suites share `loadCurrentCdm` in `test/helpers/workspace-launcher.ts`:
select a release, review its closure, Save, and wait for a visible reference type.
The project-reference flow publishes linked references before Explore; deferred
legacy-loader spinner assumptions do not apply to that flow.

J23–J28 cover workspace YAML in both themes, named Export targets and retained
outputs, Rune JSON metadata/Choice reopen, workspace selection isolation, failed
example repair, and blank workspaces returning from reference review to Explore.
Local and production wrappers reuse those journey helpers and preserve operation
evidence across reloads. J17 sweeps both themes; the fixed-dark-theme exception is
retired. Set `PROD_UX_DESKTOP_ONLY=1` for a desktop-only production run, including nested
reload steps. The default suite and local viewport tests retain phone coverage.

Use the existing `codeMirrorDocument` helper to compare source bytes across reload:
CodeMirror's rendered DOM is virtualized and is not the full document. Review the
manifest, screenshots, traces, endpoint checks and canonical deployment separately;
a passing selector does not establish that the visible state is useful. Keep real
production failures visible instead of weakening assertions or adding ledger entries.

## Public CLI and LSP dependency closure

The CLI and LSP server ship compiled modules rather than bundled workspace
dependencies. Their full runtime closure, including project-config,
project-runtime, curated-schema and instrumentation-core, must remain publishable
with public scoped access. `node --test scripts/package-publication.test.mjs`
checks that closure in CI. Build and inspect local `pnpm pack` artifacts when
changing exports or package metadata; packing is not registry publication.

## Generated Sources


Do not hand-edit generated AST, Zod, editable-domain, or conformance files.
Change the grammar, generator inputs/configuration, or authoritative generator,
then regenerate the affected surface:

```bash
pnpm --filter @rune-langium/core run generate
pnpm --filter @rune-langium/core run generate:zod
pnpm --filter @rune-langium/core run generate:domain
pnpm --filter @rune-langium/visual-editor run generate:schemas
pnpm --filter @rune-langium/codegen run generate:sql-node-types
```

Run only the generators affected by the change.

After public API changes, run `pnpm --filter @rune-langium/docs run docs:api`
and refresh each affected tracked `skills/rune-langium-*` bundle from its
`apps/docs/skills/` output. Remove obsolete reference files when the generated
layout changes; retaining them can advertise exports that no longer exist.
The package command runs from `apps/docs`: Skillit's `llmsTxtOutDir` is relative
to that working directory, so `public` refreshes the tracked LLM API indexes
in `apps/docs/public/`. The postprocessor removes generated trailing whitespace.
Include those generated indexes with API removals. Codegen API generation targets
its outbound `/export` entry; the root barrel is intentionally empty. This does
not imply generated coverage of `/import` or `/rosetta`.
Domain generation applies the same safe lint fixes as the commit hook before
formatting, so its type-only imports reproduce in CI.
The pinned `langium-zod@0.12.2` patch retains setters for contained-node unions, including recursive `RosettaAttributeReference.receiver`. Union setters use the canonical dehydrated field type; mixed primitive/node unions remain excluded. Core's generator and public-domain tests cover this surface. Remove the patch after an upstream release supports these operations and regeneration preserves the exported API.
The current Langium CLI's JSON-schema validation fails with `Invalid URL` on
Node 24/26. Node 22.13.0 was historically verified for grammar generation, before the current Node 22.22.2 floor. When the CLI asks
whether to delete additional generated files, retain `domain.ts` and
`zod-schemas.ts`; their separate generators own them.
`langium-zod` is exactly pinned in workspace overrides and core/visual-editor
manifests; update those together if deliberately upgrading the generator.
SQL node types derive from the exactly pinned `@l1xnan/tree-sitter-sql` grammar.

## Testing and Editor Setup

Vitest configs use `workspaceTestCache(import.meta.url)` for a package-local
filesystem module cache. Independent `pnpm -r test` processes otherwise share
the workspace cache and can delete each other's files while invalidating it
after lockfile changes. Keep this shared cache policy when adding a package;
it does not change test selection, timeout or retry budgets.

- Use Vitest for public APIs and shared architecture seams. Prefer focused package checks for isolated changes; broaden for affected consumers.
- Full TypeScript corpus verification: build core, curated-schema, and codegen, then run `pnpm run verify:codegen-corpus`. The check pins upstream commits in `scripts/fixtures/codegen-corpus.json`, reuses the production artifact builder and cached archives, and strictly compiles every generated file. To check a browser download, run `pnpm run verify:codegen-corpus --zip /absolute/path/typescript-output.zip`. Dependencies must be installed; the check uses the real Temporal package. Caches and serialized artifacts stay under ignored `dist/`.
- The always-on rule fixtures in `test/fixtures/regressions/rule-inference/` cover reporting/eligibility rule linking and generated TypeScript/Python execution across namespaces, including empty Choice branches. These supplement the full CDM parse/link gate; the CDM corpus may contain zero reporting/eligibility rules.
- Core's `test/conformance/cdm-corpus.test.ts` parses every CDM production file and links the complete CDM/FpML/Rune dependency workspace through `assertValidDocuments`. The projection census enforces the same gate before generating any declaration; syntax-invalid documents and unresolved references cannot be skipped. Both use `loadCorpusFixtures`, which rejects an empty dependency set. CI populates all three fixture sets through `scripts/update-fixtures.sh`; local results must identify their snapshot versions.
- The complete dependency-linking test has a three-minute budget, including under V8 coverage on shared CI runners; this is not a performance acceptance threshold. Main CI runs for every PR base, including stacked branches, so a green auxiliary check cannot substitute for the full gate.
- Real CDM/Rune/FpML fixtures live under hidden `.resources/`. Prefer them for corpus repros, and guard or skip corpus-dependent tests when absent.
- Hermetic upstream test slices live in [test/fixtures/third-party](../../test/fixtures/third-party/README.md), with their pinned licenses, notices and integrity manifests. Studio's expression cohort uses the existing `referenceFiles` integrity loader through `expressionReferenceFiles`; keep its source bytes unchanged when relocating it.
- Verify fixture revisions before claiming upstream parity. The September 12 refresh found a February Rune reference checkout; current production CDM/FpML needed `as` narrowing and schema declarations. A successful parse or ZIP download does not establish that the entire generated corpus passes strict TypeScript compilation.
- Studio Playwright tests must wait for visible readiness, not `networkidle`, when workers or LSP traffic remain active.
- Structure expansion diagnostics: with an owned Studio server, run `PLAYWRIGHT_BASE_URL=http://127.0.0.1:5193 pnpm --filter @rune-langium/studio exec playwright test test/perf/structure-expansion.spec.ts --retries=0 --reporter=list`. The attached JSON measures actual click-to-DOM, first animation frame and stable child bounds for small/dense branches and unrelated workspace declarations. It excludes automation's click preparation and does not impose a machine-specific budget. October 20 local development samples showed 13–21ms for two fields and 34–96ms for 100 fields; these are diagnostic samples, not deployed acceptance or a proven root cause.
- Use `fullSourceEditor(page)` from `apps/studio/test/helpers/source-editor.ts` for full-file Source checks in local and production browser journeys. A global `source-editor` test ID or visibility filter can also match visited Inspector condition editors; scope expression editors to their implementation region instead.
- Curated artifact persistence: run Studio's `test/services/curated-artifact-cache.test.ts`, `test/services/workspace-curated-persistence.test.ts`, `test/services/workspace-parse-routing.test.ts`, `test/components/App-workspace-isolation.test.tsx`, and `test/integration/curated-source-editor.test.tsx`. `playwright test test/e2e/curated-cache.spec.ts --retries=0` uses isolated browser contexts and fixture API responses to verify real IndexedDB reuse across reloads/tabs, normal Explorer/Source navigation reuse, legacy source loading, parser linking, recovery after payload eviction, and corrupt deferred JSON recovery when either fixture namespace is first linked. Unit checks also cover coalesced recovery, workspace changes during refetch and fresh-network failures. It does not require a hosted LSP or assert production timings.
- Progressive curated Inspector hydration: run `test/workers/curated-declaration.test.ts`, `test/services/curated-declaration.test.ts`, `test/shell/CuratedDeclarationInspector.test.tsx` and `test/e2e/curated-progressive-inspector.spec.ts`. The browser check withholds the full closure until actual declaration fields are visible, then verifies inherited Inspector content, a preview field, original Source and reload reuse. J05 distinguishes `inspectorFirstContent` from full `hydration`; the declaration-first marker is never semantic readiness. Use an owned Vite server and `PLAYWRIGHT_BASE_URL`. The [investigation](../investigations/2026-10-18-curated-progressive-hydration.md) records the local CDM A/B measurements and pending deployed acceptance.
- Background curated seeding: add `test/services/curated-cache-client.test.ts`, `test/services/curated-cache-seeder.test.ts`, Pages' parse tests and `test/e2e/curated-background-cache.spec.ts`. The browser regression uses real SharedWorker/dedicated workers and IndexedDB, verifies one shared download across two tabs and a subsequent foreground hydration with zero downloaded model documents. Chromium target interception supplies the public gzip fixture because Playwright page routing does not intercept SharedWorker traffic. Run against an explicitly owned Vite server via `PLAYWRIGHT_BASE_URL`; the suite does not measure production latency. Keep `pako` in Vite's eager dependency-discovery entries so a first background fetch does not cause a development reload.
- Curated latency diagnostics can enable the existing opt-in trace pipeline for `previewHydrateDocuments`, `previewBuildDocuments`, `previewGenerateSchema`, `previewGenerateProjection` and `previewExecuteFunction`. These worker boundaries capture timings without source, AST or instance values, including sanitized failure signatures. Compare router/cache spans separately; nested stage timings are not additive. The [October 18 investigation](../investigations/2026-10-18-curated-performance-and-optimization.md) records local proxy limits, matched-order function checks and the description-only linking gate.
- Expression editing: `pnpm --filter @rune-langium/studio exec playwright test test/e2e/expression-workspace.spec.ts --retries=0` checks the pinned CDM function and Data-condition slices, body-only generated views, expansion without remounting, builder draft/undo, dialog accessibility and narrow layouts at the largest pane font setting. The portal dialog additionally receives 125% root text scaling, with computed-size proof before bounds and axe scans. Source/Inspector network ownership additionally requires `PLAYWRIGHT_EXPRESSION_LSP=1` and a local LSP Worker, with Studio's `VITE_LSP_SESSION_URL` and `VITE_LSP_WS_URL` pointing at it. The network cases also verify both split-file dispatch orders without missing-document protocol errors. They skip explicitly without the Worker; unit tests still cover read-only, stale revision and workspace-change guards. Hosted curated read-only and the production J10 journey require a deployed build and are separate from local acceptance.
- Production smoke: `pnpm --filter @rune-langium/studio run test:prod-smoke`. Endpoint and fuller UX checks are documented in [TESTING.md](../TESTING.md).
- Code-tab managed downloads: run `test/components/CodePreviewPanel-table-flow.test.tsx`,
  `test/components/DownloadConfigDialog.test.tsx` and `test/services/export-request.test.ts`.
  The desktop `test/e2e/reference-code-download.spec.ts` uses a pinned reference fixture
  and the real download worker, checks ZIP contents/receipt and dialog accessibility.
  Production J11 checks the published CDM namespace and downloaded artifact separately.
- Tailwind IntelliSense uses `.vscode/settings.json`: `tailwindCSS.experimental.configFile` maps `apps/studio/src/app.css` to Studio, design-system, and visual-editor source trees.

## Claude Design Sync

- `.design-sync/` holds the inputs for syncing `@rune-langium/design-system` (plus visual-editor presentational pieces) to the claude.ai/design project "Daikonic Studio Components" via the `/design-sync` skill: `config.json`, authored `previews/<Name>.tsx` (story source: the prod-ux journeys), the `conventions.md` header the design agent reads, and the Tailwind entry compiled by `build-css.mjs`.
- Read `.design-sync/NOTES.md` before re-syncing — it records the build steps, composition gotchas, and re-sync risks. Staged converter scripts (`.ds-sync/`), build output (`ds-bundle/`), and grades (`.design-sync/.cache/`) are ignored.
- Build from the repo root with `node .design-sync/build.mjs` after staging the converter. The wrapper derives visual-editor prop declarations from TypeScript component signatures into ignored `.design-sync/.cache/config.json` before invoking the converter. Do not maintain handwritten `dtsPropsFor` in the tracked configuration.
- CI type-checks every authored preview and checks generated/source prop assignability plus Command filtering and selection. The commands in `.design-sync/NOTES.md` also cover local bundle rendering.
- When a design-system component's API, class vocabulary, or tokens change, re-sync so the design agent's `.d.ts`, previews, and conventions stay true.

## Shared Agent Configuration

- Keep Claude plugin preferences in `.claude/settings.json`; do not copy Claude hook or permission syntax into Codex configuration. Preserve ignored local settings and machine-specific MCP registrations.
- Infigraph is supplied through the active agent environment. Check tool availability before adding a duplicate project MCP server. `.mcp.json` currently configures Playwright.
- For new skills, put the canonical copy in `.agents/skills/<skill-name>/` and a relative symlink at `.github/skills/<skill-name>` pointing to `../../.agents/skills/<skill-name>`.

## Comment Review

Requires the `ast-grep` CLI on PATH. The audit is read-only:

```bash
pnpm run audit:comments
node scripts/audit-comments.mjs --json > /tmp/rune-comment-audit.json
node scripts/audit-comments.mjs packages/codegen/src
pnpm run test:comment-audit
```

`rules/comment-audit.yml` queries comment nodes in TypeScript, TSX, and JavaScript,
including JSDoc. The reporter groups consecutive line comments only when no code
separates them. It selects multiline groups and comments mentioning spec/issue
references or historical phrases, ranking references/history before length.

The default scope is `apps` and `packages`. Scripts, generated directories,
tests, fixtures, dependencies, and dist output are excluded. Comments containing
license, compiler, linter, coverage, or instrumentation directives are also
excluded. These exclusions favor retaining directives over finding every comment.

Matches are review candidates, not violations. Keep API contracts, format tables,
and security/lifecycle constraints. Remove planning or review history and comments
that merely repeat the code; preserve substantive rationale when shortening.
There is no autofix or commit gate. `sgconfig.yml` uses repository-relative paths.

## Source Audit

Oxlint uses `oxlint.config.ts` with `defineConfig` from `oxlint`. The old
`oxlintrc.json` name was not discovered by the CLI, and its nested rule names were
invalid. Newly activated import/type-style rules start as warnings so existing
findings do not block unrelated work. Nested package configurations still apply
to normal `pnpm run lint`.

```bash
pnpm run audit:source
pnpm exec oxlint --config oxlint.audit.config.ts --disable-nested-config apps packages --format json
```

The audit enables type-aware assertion/union checks through `oxlint-tsgolint`,
plus selected redundant-control-flow and spread rules. Build workspace dependencies
first when declaration output is missing or stale. Tests, scripts, fixtures,
dependencies, and build output are excluded. Generated source is included for
review; fix its authoritative generator rather than applying fixes to generated
files. Codegen golden outputs may need regeneration when generator output changes.

Treat diagnostics as review candidates. Apply only reviewed rule-specific safe
fixes, then run type checking and affected tests. An assertion removal should not
change emitted JavaScript. The typed configuration format is experimental in the
installed Oxlint CLI and runs through its Node entry point (`pnpm exec oxlint`).

## Copilot CLI Language Server

`.github/lsp.json` starts the workspace TypeScript 7 native LSP with
`pnpm exec tsc --lsp --stdio`; the root `lsp.json` is a compatibility symlink.
Run `pnpm install` first. TSX/JSX use their React language IDs. The Rust server
entry is preserved and requires `rust-analyzer` on PATH.

After changing the config, exit and relaunch Copilot CLI, then run `/lsp` to
check status. This config does not add an LSP tool to an already-running Codex
session. The native server can also be queried over standard LSP stdio.

Curated publication changes: run `node --test scripts/lib/curated-sources.test.mjs scripts/upload-serialized-artifacts.test.mjs`. These verify source selection, dependency ordering, immutable cohort manifests, and failures at every latest-pointer step without writing to R2. Run Studio Pages Function tests for shared parse/download closure and cohort selection, and mirror-worker tests for cron metadata preservation when changing publication.

The nightly artifact builder follows CDM `master`, resolves that exact commit's
`rune-fpml.version` and `rosetta.dsl.version` to released dependency commits, and
records the cohort in `resolved-sources.json`. CDM's direct Rune dependency can
upgrade FpML's older transitive requirement within the same major version;
newer or cross-major requirements fail selection. Every selected document must
still pass the linking gate. `--sources` accepts an explicit cohort for reproducible
checks; `scripts/fixtures/codegen-corpus.json` records the verified cohort.

Nightly is a moving curated view of upstream `master`, with no stability or
reproducibility guarantee. Commit and build date describe provenance, not a
release. An explicit `cdm_release` dispatch verifies that upstream release tag and
its dependency releases, publishes immutable source/serialized artifacts and
cohort manifests, then promotes release catalogs in dependency order. It never
advances Nightly's `latest` pointers. The shared uploader serializes workflow runs
and preserves the same immutable dependency closure for both publication paths.
Source archives use their own SHA-256 object keys and checksums; release catalog
promotion requires their upload receipts alongside the serialized artifacts.

CDM still uses legacy function annotations removed by
[Rune's schema migration](https://github.com/finos/rune-dsl/commit/5ed7142f1a6b2e82885e9ab1e9cb5b8479d67c8b).
Both artifact builders apply core's `addLegacyAnnotations` to the runtime annotation
document before linking. It adds only missing `ingest`, `enrich`, and `projection`
declarations, reusing the same definitions as the bundled standard library.
Upstream declarations and newer schema annotations are preserved; unknown names
remain errors. Serialized annotation documents include this explicit dialect
compatibility bridge; upstream archive bytes and their hashes remain unchanged.

The CDM reference battery uses checked-in sources and Python goldens, so normal tests need no Python or downloads. [Its fixture guide](../../packages/codegen/test/fixtures/cdm-reference/README.md) documents regeneration and explicit coverage limits. Run the codegen compilation matrix and Studio worker parity test together when changing function semantics or input adapters.

## Dependency Merge Readiness

`auto-approve-deps.yml` approves eligible trusted-bot dependency updates; it does
not request auto-merge while its own checks are pending. `Finalize Dependency
Updates` runs after CI/approval workflows complete and reads only the trusted
default-branch helper. It reloads the PR, verifies the same repository and commit,
requires approval, no changes-requested reviews, successful core CI gates and all
reported checks to finish successfully, then uses the ordinary merge API with an
expected SHA. Approval (`pull_request_target`) completions use the associated PR
snapshot’s head SHA; their workflow SHA can identify the base commit. Missing
snapshots and stale heads never fall back to that base commit. Major/security
updates remain manual. Unknown API errors fail the
workflow; pending checks simply wait for another completion event. The existing
GitHub Actions version-pin job remains separate.

Validate workflow changes with `node --test scripts/lib/dependency-automerge.test.mjs`
and a workflow syntax checker. An old failed auto-approval run (such as #551) needs a fresh PR event after
the fix lands, for example a bot refresh/rebase. Rerunning the old run preserves
its original workflow revision. The finalizer never ignores failed checks.

## Unified zod-to-form Migration Verification

The migration uses published core **0.12.0**, React **0.13.0**, codegen **0.11.0**, Vite **0.5.0**, and Zod **4.6.5**. The registry lockfile resolves those npm releases.

Verified on the supported Node **22.22.2** floor:

- `pnpm install --frozen-lockfile --engine-strict`.
- Studio config tests: 6 pass, including real Excel defaults/rejection parity with compilation off/on.
- Visual-editor editor/section tests: 183 pass.
- Studio production bundle and visual-editor build.

Full workspace type checks and explicit bundler-resolution TypeScript checks of both config files also pass. Rebuild Studio's dependencies before type checking when their compiled exports are stale.

Compilation remains disabled. All five hand-authored EditorForms enable L1 through a shared policy and schema-derived Controller validation bridge. Regression checks cover canonical identifier unions, optional values, independent field validation, and array reorder/remove/add. Safe L2 adoption is tracked in [issue #574](https://github.com/pradeepmouli/rune-langium/issues/574).

## Python projection checks

Codegen builds regenerate the browser-safe runtime string from
`packages/codegen/src/projection/python-runtime.py`. Edit that Python source;
never hand-edit `projection/generated/python-runtime-source.ts`.
`pnpm --filter @rune-langium/codegen run generate:python-runtime` regenerates it;
`node packages/codegen/scripts/generate-python-runtime.mjs --check` verifies it.
Python projection tests require Python >=3.13 and fail explicitly if it is absent.
Set `PYTHON_BINARY` to the supported interpreter when the shell's `python3` is older.
The standard-library driver checks Python 3.13 syntax and compares runtime behavior
with the shared TypeScript helpers; it does not run Python inside Studio.

The `Python Projections` workflow runs the grammar census, syntax/runtime tests,
pinned CDM execution battery and both inverse round-trip suites on every PR; it
has no path filter. Main CI also installs Python 3.13 before package tests.
The staged corpus scan reuses core's fixture loader and links all three bundles
together. Its ignored `packages/codegen/dist/python-projection-coverage.json`
records versions, content hashes, counts and syntax/linking exclusions. The
checked-in census and execution battery remain required when `.resources` is absent.

## Inspector validation (#562 / #595)

Main CI's `lint-and-test` job has a 30-minute budget for the full package suite and root coverage run. PR #601's 20-minute run passed package tests but hit GitHub's job timeout during coverage; this budget preserves both runs and subsequent audit/bundle checks.

Use the shared construct assessment rather than a LOC threshold. Test canonical field/target/metadata actions, form selection/leases/flush, rich source trivia and parsed render/reconcile seams. Core grammar changes require regeneration of AST, domain operations and both Core/visual-editor schemas with their package scripts; never patch generated schema text. Regenerated DataReference/AttributeReference receivers are recursive canonical unions, not UI approximations.

`PLAYWRIGHT_BASE_URL=http://127.0.0.1:5174 pnpm --filter @rune-langium/studio exec playwright test test/e2e/inspector-details.spec.ts test/e2e/expression-workspace.spec.ts --retries=0` checks saved OPFS source before reload, enum paging/display/reorder, inherited inspection/override, bounded pointer/touch/keyboard divider behavior, 200% text size/axe and continuous implementation sessions. Start an owned Vite server directly on 5174; preserve user servers and browser tabs. `pnpm --filter @rune-langium/studio run test:z2f-hmr` uses a disposable schema copy and its own random-port server. Read all attached screenshots and report the explicit network-LSP/hosted coverage gaps.

Studio worker formatter imports are listed in `vite.config.ts`'s dependency
optimization entries; the Node-only Ruff entry is excluded from browser discovery.
Keep these subpaths explicit when updating formatter packages so a cold development
session does not trigger a late dependency reload. Validate with `pnpm --filter
@rune-langium/studio run test:z2f-hmr` and the expression browser journey's Python
view; production formatter imports remain lazy.

## Prototype workflow verification

For Flow changes, run Studio's `workflow-validation`, `preview-session-client`,
`function-session-store`, `InstanceInspectorPanel`, arrival and Prototype perspective
unit suites, plus `packages/codegen/test/emit/function-input-checks.test.ts`.
`PLAYWRIGHT_BASE_URL=http://127.0.0.1:<owned-port> pnpm --filter @rune-langium/studio exec playwright test test/e2e/prototype-workbench.spec.ts --retries=0`
checks real worker preconditions/execution, stale output invalidation, primitive and
scalar returns, bypass, bulk import and equal bindings, and viewport/axe checks.
Rebuild codegen before Studio consumes new generated metadata. Preserve user-owned
servers and worktrees. Local checks do not establish deployed acceptance.

Prototype/Explore navigation changes: include Studio's `test/services/prototype-navigation.test.ts`, `test/services/workflow-navigation.test.ts`, and `test/components/WorkflowNode.test.tsx`. The `type-navigation` journey in `test/e2e/prototype-workbench.spec.ts` checks input/function navigation, pointer and keyboard context menus, Inspector return actions and retained drafts/results. Native text-field menus remain available; declaration identity includes kind, independently of labels.

Reference example/codec changes: run Core's Rune JSON tests, project-config example
reader tests, project-runtime reference/example/data suites, Codegen preview and
metadata suites, and Studio's ReferenceExampleImport, FormPreviewPanel, example
repository, preview-session-client, project-worker-bridge and real worker suites.
`PLAYWRIGHT_BASE_URL=http://127.0.0.1:<owned-port> pnpm --filter @rune-langium/studio exec playwright test test/e2e/reference-examples.spec.ts --retries=0`
checks desktop/390px discovery, metadata-preserving input edits, explicit binding,
execution, Save/reopen, viewport fit and axe. Its transport/model fixture tests
integration; the separate pinned CDM payload test establishes upstream byte and
codec fidelity, not a complete CDM trade. Pinned third-party fixtures are excluded
from formatting so upstream bytes and integrity hashes stay intact.

Code-list changes: run project-runtime's `code-lists`/`project-capabilities` suites,
Codegen's `runtime/project-bindings` suite and Studio's `PreviewEnumInput`/
`FormPreviewPanel` suites. `test/e2e/project-resources.spec.ts` verifies the pinned
CDM list in desktop/390px Prototype, execution/unknown-code validation and resource
availability recovery. Preserve pinned third-party bytes and integrity manifests.

Native catalog changes: run Codegen's `test/implementations` plus Python runtime
checks and the Studio real-worker suite. Run `pnpm run verify:native-implementations`
after building Core/Codegen/project-runtime; it verifies Git hashes and the pinned
cohort's declarations/signatures/target coverage. Source pins and inventory updates
must be reviewed together; `--write` is explicit. The native calendar browser
journey in `test/e2e/native-implementations.spec.ts` covers desktop/390px execution,
viewport fit and axe. Keep unavailable financial engines/data dependencies visible.

Materialized resource enums: include Codegen's `test/runtime/code-list-enum.test.ts`
and project-runtime's `code-lists`, `project-capabilities` and `build-project`
suites. They check unsanitized wire codes, identifier collisions, labels,
standalone TypeScript/Python execution, schema/SQL/XSD generation without injected
resource adapters, and unchanged source bytes across a fresh graph. The desktop
`project-resources.spec.ts` journey checks punctuation-bearing values through the
real managed worker plus invalid-resource recovery; retain the pinned CDM list case.

Generated XSD validation tests require libxml2's `xmllint` on PATH (or
`XMLLINT_BINARY` pointing to it). macOS supplies it; Debian/Ubuntu use
`libxml2-utils`, installed explicitly in the main CI job. The shared
`test/helpers/xsd-validation.ts` compiles the emitted local schema closure with
network access disabled and validates accepted/rejected XML instances. A parser
or string-presence assertion alone does not establish XSD correctness.

## Reference example corpus gate

Run `pnpm run verify:reference-examples` after building core, codegen and
project-runtime. CI uses checksum-pinned CDM 7.8.0 with its FpML 3.8.0 and Rune
10.15.1 dependencies, scans every JSON/XML path, checks descriptor references and
imports typed JSON examples through shared preparation plus the linked decoder.
The report at `dist/reference-example-import-report.json` distinguishes genuine
imports from headerless selection requirements, array inputs and pinned empty
upstream files. Unknown Rune payloads outside discovery roots fail the gate.
Review the complete inventory when changing pins; never normalize upstream bytes
or add a blanket expected-failure allowance. XML remains a separate codec milestone.

Execution catalogs use the upstream `*-execution-descriptor.json` array contract
(`inputFile`, `expectedOutputFile`, `executableFunctionClass`, name/description and
optional Markdown/native-function metadata). Shared schema/path validation refuses
traversal and conflicting bindings. Cataloged input bundles import with the exact
Rune function identity, retaining the original catalog entry in provenance. Import
leaves the current workflow unchanged; explicitly selecting the saved bundle opens
the function and seeds its argument fields. Java-only catalog functions remain
unavailable until their implementation is supported.
