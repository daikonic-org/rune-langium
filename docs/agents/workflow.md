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
- For temporary Pages diagnostics, set the non-secret `INSTRUMENTATION_*` values in the build environment. The combined build writes only those values to the generated root `wrangler.toml`; rebuild and redeploy to enable or remove them. Keep secrets in Cloudflare.

## Form Dependencies

`@zod-to-form/react@0.13.0` exports the shared `SectionRenderer` used by custom Inspector layouts, from [zod-to-form PR #222](https://github.com/pradeepmouli/zod-to-form/pull/222). Use that public export directly. Keep exact core/React package declarations and workspace overrides aligned, and recheck configured Inspector sections when upgrading.

Keep `@zod-to-form/vite` exactly pinned to `0.5.0` in Studio and visual-editor for the unified configuration contract. Babel 8 requires Node `^22.18.0 || >=24.11.0`; the current jsdom 30.1 test toolchain requires the higher range `^22.22.2 || ^24.15.0 || >=26.0.0`. Workspace and package engine declarations use that combined supported range. Older Node 22/24 releases and Node 23/25 are unsupported. The previous `0.4.8` plugin compatibility pin applied to the old Node 22.13 floor.

## Dependency Compatibility and Audit Exceptions

`@lspeasy/core@3.0.1` imports `type-fest` in its published declarations without declaring the dependency. The workspace package extension supplies `type-fest@5.10.0` so type checking cannot pick up an incompatible hoisted copy from another tool. [Upstream issue #307](https://github.com/pradeepmouli/lspeasy/issues/307) tracks removal after the package declares its own dependency.

`patchedDependencies` applies a nesting/AST traversal guard to every transitive `braces@3.0.3` copy used by development tooling. The patch backports only the structural guards from [upstream PR #82 at commit `1f11eb5`](https://github.com/micromatch/braces/pull/82/commits/1f11eb558be9ea0cda87861408bb766e2e714086); it does not include that PR's separate range or parent-queue changes. Parsing permits at most 128 nested brace/parenthesis containers. Recursive walkers reject child depth over 128, child cycles and more than 65,536 visits with `SyntaxError` / `ERR_BRACES_COMPLEXITY`. Shared acyclic children remain valid. Terminal nodes add an edge, so 127 parsed containers leave room for a literal leaf in subsequent traversal. These bounds do not limit Cartesian expansion cardinality or arbitrary AST property getters.

Run `node --test scripts/braces-patch.test.mjs` after install or dependency changes; CI verifies the patch through the actual Stylelint dependency. The test's optional `BRACES_TEST_PACKAGE` path allows comparison against an unpatched package without changing workspace resolution.

The audit still identifies the patched package as version 3.0.3, so `auditConfig.ignoreGhsas` remains limited to `GHSA-vfj7-8cjw-p6xm`. This version-based exception accompanies a local runtime mitigation; it does not mean npm has published a fixed release. [Issue #572](https://github.com/pradeepmouli/rune-langium/issues/572) tracks replacing the backport and removing the exception when that release is available. Use `pnpm audit --prod` to check the production tree separately.

Keep TypeScript `6.0.3` in docs and the `typescript-classic` alias in codegen: TypeDoc's peer range and codegen's compiler API need that release, while normal workspace compilation uses TypeScript 7.

After CodeMirror updates, run `pnpm dedupe` and check `pnpm why -r @codemirror/state @codemirror/view`. Studio and its LSP client must resolve the same state/view classes; duplicate copies make editor extensions and workspace overrides incompatible. Force affected TypeScript builds afterward to invalidate cached module resolutions.

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
Domain generation applies the same safe lint fixes as the commit hook before
formatting, so its type-only imports reproduce in CI.
The current Langium CLI's JSON-schema validation fails with `Invalid URL` on
Node 24/26. Node 22.13.0 was historically verified for grammar generation, before the current Node 22.22.2 floor. When the CLI asks
whether to delete additional generated files, retain `domain.ts` and
`zod-schemas.ts`; their separate generators own them.
`langium-zod` is exactly pinned in workspace overrides and core/visual-editor
manifests; update those together if deliberately upgrading the generator.
SQL node types derive from the exactly pinned `@l1xnan/tree-sitter-sql` grammar.

## Testing and Editor Setup

- Use Vitest for public APIs and shared architecture seams. Prefer focused package checks for isolated changes; broaden for affected consumers.
- Full TypeScript corpus verification: build core, curated-schema, and codegen, then run `pnpm run verify:codegen-corpus`. The check pins upstream commits in `scripts/fixtures/codegen-corpus.json`, reuses the production artifact builder and cached archives, and strictly compiles every generated file. To check a browser download, run `pnpm run verify:codegen-corpus --zip /absolute/path/typescript-output.zip`. Dependencies must be installed; the check uses the real Temporal package. Caches and serialized artifacts stay under ignored `dist/`.
- Real CDM/Rune/FpML fixtures live under hidden `.resources/`. Prefer them for corpus repros, and guard or skip corpus-dependent tests when absent.
- Hermetic upstream test slices live in [test/fixtures/third-party](../../test/fixtures/third-party/README.md), with their pinned licenses, notices and integrity manifests. Studio's expression cohort uses the existing `referenceFiles` integrity loader through `expressionReferenceFiles`; keep its source bytes unchanged when relocating it.
- Verify fixture revisions before claiming upstream parity. The September 12 refresh found a February Rune reference checkout; current production CDM/FpML needed `as` narrowing and schema declarations. A successful parse or ZIP download does not establish that the entire generated corpus passes strict TypeScript compilation.
- Studio Playwright tests must wait for visible readiness, not `networkidle`, when workers or LSP traffic remain active.
- Curated artifact persistence: run Studio's `test/services/curated-artifact-cache.test.ts`, `test/services/workspace-curated-persistence.test.ts`, `test/services/workspace-parse-routing.test.ts`, `test/components/App-workspace-isolation.test.tsx`, and `test/integration/curated-source-editor.test.tsx`. `playwright test test/e2e/curated-cache.spec.ts --retries=0` uses isolated browser contexts and fixture API responses to verify real IndexedDB reuse across reloads/tabs, lazy source reuse, parser linking, recovery after payload eviction, and corrupt deferred JSON recovery when either fixture namespace is first linked. Unit checks also cover coalesced recovery, workspace changes during refetch and fresh-network failures. It does not require a hosted LSP or assert production timings.
- Expression editing: `pnpm --filter @rune-langium/studio exec playwright test test/e2e/expression-workspace.spec.ts --retries=0` checks the pinned CDM function and Data-condition slices, body-only generated views, expansion without remounting, builder draft/undo, dialog accessibility and narrow layouts at the largest pane font setting. The portal dialog additionally receives 125% root text scaling, with computed-size proof before bounds and axe scans. Source/Inspector network ownership additionally requires `PLAYWRIGHT_EXPRESSION_LSP=1` and a local LSP Worker, with Studio's `VITE_LSP_SESSION_URL` and `VITE_LSP_WS_URL` pointing at it. The network cases also verify both split-file dispatch orders without missing-document protocol errors. They skip explicitly without the Worker; unit tests still cover read-only, stale revision and workspace-change guards. Hosted curated read-only and the production J10 journey require a deployed build and are separate from local acceptance.
- Production smoke: `pnpm --filter @rune-langium/studio run test:prod-smoke`. Endpoint and fuller UX checks are documented in [TESTING.md](../TESTING.md).
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
