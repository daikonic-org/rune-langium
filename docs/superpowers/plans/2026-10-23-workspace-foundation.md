# Portable Workspace Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make project settings portable, editable and safely saved, with explicit named builds shared by Studio and CLI.

**Architecture:** Introduce host-neutral project-config and a composing project-runtime. Inject generator validation into config normalization; do not import codegen into project-config. Backing adapters use revisioned file operations and a recoverable journal.

**Tech Stack:** Existing TypeScript/ESM, Zod 4, Vitest, Node filesystem adapters, React/Zustand and OPFS; use the existing transitive `yaml` package as a direct dependency for its document/CST API after checking its pinned version.

**Spec:** [Approved design](../specs/2026-10-23-portable-workspaces-reference-models-design.md); [global constraints and order](2026-10-23-portable-workspaces.md).

## Global Constraints

All index constraints apply. `schemaVersion: 1`; new config files use `.yml`; accept `.yaml` but reject both spellings together. Default directories are `model/`, `resources/`, `examples/`, `workflows/`, `layouts/`, ignored `generated/` and `exports/`. No default target, automatic Maven execution or product dependency on browser storage. Reuse normal hooks; configuration/schema changes update docs and dependency manifests in the same task.

## Review Focus

1. A duplicate YAML key or merge can silently change a build: T1 must diagnose duplicates and unsupported aliases rather than normalize them ambiguously.
2. Windows-style traversal, absolute paths and symlink escapes can overwrite source: T2 and T5 reject them at normalized path and filesystem boundaries.
3. Another tab can edit a file during Save: T3 detects revision conflicts and recovers partial writes without overwriting new bytes.
4. A late workspace activation can replace newer state: T4/T6 bind results to workspace identity and revision.
5. An unavailable generator must never fall back to Zod or the first target: T2/T5 return a capability diagnostic before writing output.

## Shared contract decisions

Define these exported types in `project-config/src/types.ts` in T1; later plans use the same names:

- `ProjectDiagnostic = { code: string; severity: 'error' | 'warning'; path: string; message: string; target?: string }`.
- `SymbolIdentity = { model: string; namespace: string; kind: string; name: string; dispatch?: string }`.
- `BuildTarget = { generator: string; options: Record<string, unknown>; output: string; namespaces?: string[] }`.
- `ReferenceRequest = { repository: string; release: string }`.
- `BuildConfig = { schemaVersion: 1; runeConfig: string; sources: string[]; resources: { path: string }[]; references: Record<string, ReferenceRequest>; targets: Record<string, BuildTarget>; overrides?: ProjectOverride[] }`.
- `ProjectOverride` is a discriminated union: declaration `{kind:'declaration',source:SymbolIdentity,replacement:SymbolIdentity}`, resource `{kind:'resource',source:{model:string,id:string},path:string}`, implementation `{kind:'implementation',source:SymbolIdentity,provider:string}`.
- `StudioConfig = { schemaVersion: 1; examples: string; workflows: string; layouts: string }`.
- `ProjectFiles = ReadonlyMap<string, string>`; `ConfigDocument = { path:string; text:string }`.
- `NormalizedProject = { build:BuildConfig; studio:StudioConfig; rune:Readonly<Record<string,unknown>>; diagnostics:ProjectDiagnostic[] }`.
- `ProjectSnapshot = { workspaceId:string; revision:string; files:ProjectFiles; project:NormalizedProject; lock?:ProjectLock }`.
- `ProjectLock` schema is introduced in T1 as versioned JSON with `configHash`, `toolchain`, and `references`; each reference has `repository`, `release`, `commit`, `manifest`, `cohort`, `checksum`, and `dependencies:Record<string,string>`. P2 validates resolution/compatibility.
- `TargetValidator = (target: BuildTarget) => ProjectDiagnostic[]`; no hidden generator defaults.

### Task 1: Companion discovery and lossless configuration

**Files:** Create `packages/project-config/{package.json,tsconfig.json,vitest.config.ts,README.md}`, `src/{index,types,config-schema,config-codec,rune-compat}.ts`, `test/config-codec.test.ts`; modify `pnpm-lock.yaml`, `docs/agents/architecture.md`.

**Interfaces:** Produce `discoverProjectConfig(files:ProjectFiles):{build?:ConfigDocument;studio?:ConfigDocument;diagnostics:ProjectDiagnostic[]}`, `parseBuildConfig(document:ConfigDocument):{value?:BuildConfig;diagnostics:ProjectDiagnostic[]}`, `updateBuildConfig(document:ConfigDocument,next:BuildConfig):string`, `normalizeProject(files:ProjectFiles,validateTarget:TargetValidator):NormalizedProject`. Add analogous Studio parsing/updating, preserving unknown companion fields/comments; rune-compat reads known upstream fields without rewriting them.

- [x] Write failing cases in `config-codec.test.ts`: `.yaml` alone loads; both extensions diagnose `CONFIG_AMBIGUOUS`; duplicate keys diagnose `CONFIG_DUPLICATE_KEY`; update SQL options preserves comments and unknown fields; `schemaVersion:2` blocks Save; `defaultSerialisationFormat` does not select a target; namespace entries merge by ID with whole-entry project precedence.
- [x] Run `pnpm --filter @rune-langium/project-config test -- config-codec.test.ts`; expect failure until the new API exists.
- [x] Implement the schemas/codecs and package scaffolding above. Parse YAML as documents and apply supported edits through nodes; reject unsupported alias/merge constructs with source diagnostics. Default only the conventional paths, never a target. Parse lock JSON separately; unknown schema versions remain readable raw text but not executable.
- [x] Run the same test command and `pnpm --filter @rune-langium/project-config run type-check`; expect all tests and types to pass. Confirm no dependency path from project-config to Studio/core/codegen.
- [x] Commit only these paths and the lockfile: `git commit -m "feat: add portable project configuration contracts"`.

### Task 2: Authoritative target validation and path constraints

**Files:** Create `packages/codegen/src/options/target-options.ts`, `packages/codegen/test/options/target-options.test.ts`, `packages/project-config/src/output-paths.ts`, `packages/project-config/test/output-paths.test.ts`; modify `packages/codegen/src/{export,types}.ts`, existing option schemas as needed, Studio `src/components/export-target-settings.ts`.

**Interfaces:** Consume `BuildTarget`, `TargetValidator` from T1 only in the runtime adapter later. Codegen produces `validateTargetOptions(target:string,options:unknown):{value?:Record<string,unknown>;errors:string[]}` and `getGeneratorCapabilities():ReadonlyArray<{id:string;available:boolean}>` without importing project-config. Project-config produces `validateOutputPaths(targets:Record<string,BuildTarget>,protectedPaths:readonly string[]):ProjectDiagnostic[]`.

- [x] Add failing cases asserting PostgreSQL and SQL Server configurations remain distinct; invalid dialect/layout is rejected; Excel/OpenAPI options use existing schemas; unavailable generator reports unavailable; `../model`, drive paths, nested overlapping outputs and config/example destinations are rejected.
- [x] Run `pnpm --filter @rune-langium/codegen test -- target-options.test.ts` and `pnpm --filter @rune-langium/project-config test -- output-paths.test.ts`; expect new-contract failures.
- [x] Implement validation in the owning generator package and the portable output-path guard. Reuse existing option types/schemas/registries; do not duplicate emitter availability lists in Studio or config. Treat directory ancestry as a collision, not a string-prefix match.
- [x] Rerun both suites plus both package type checks; expect pass. Rebuild codegen before Studio verification, since Studio consumes dist.
- [x] Commit: `git commit -m "feat: share generator option validation for project targets"`.

### Task 3: Revisioned Save and interrupted-write recovery

**Files:** Create project-config `src/{project-files,save-transaction}.ts`, `test/save-transaction.test.ts`; Studio `src/workspace/project-file-adapter.ts`, `test/workspace/project-file-adapter.test.ts`; modify `src/workspace/{workspace-files,folder-backing,workspace-manager}.ts` only at actual read/write seams.

**Interfaces:** Produce `ProjectFileAdapter` with `read(path:string):Promise<{text:string;revision:string}|undefined>`, `write(path:string,text:string,expectedRevision:string|null):Promise<string>`, `remove(path:string,expectedRevision:string):Promise<void>`, `list():Promise<string[]>`. A null revision requires absence. Define `ProjectWrite={path:string;text:string;expectedRevision:string|null}`; produce `saveProject(adapter:ProjectFileAdapter,writes:readonly ProjectWrite[],operationId:string):Promise<{status:'saved'|'conflict'|'recoverable';diagnostics:ProjectDiagnostic[]}>` and `recoverProjectSave(adapter:ProjectFileAdapter):Promise<ProjectDiagnostic[]>`.

- [x] Write failing injected-backend tests: conflict on a changed revision before commit, failure after the first of three writes, reopen recovery, retry idempotence, a concurrent third-party edit during recovery, denied folder permission and wrong-workspace adapter use. Assert no newer bytes are replaced and the snapshot is unpublished on partial failure.
- [x] Run `pnpm --filter @rune-langium/project-config test -- save-transaction.test.ts` and `pnpm --filter @rune-langium/studio test -- project-file-adapter.test.ts`; expect failures.
- [x] Implement a durable prepare/commit journal under the private backing namespace with operation identity, original/proposed revisions and readback. Recovery completes only if all revisions match the journal; otherwise preserve files and report a conflict. Reuse ownership coordination, retaining the workspace ID inside the adapter closure. Never copy the OPFS token directory into repository `/files`.
- [x] Rerun both suites; assert journal/private paths are outside adapter `list()` of project-managed files. Verify successful Save through readback rather than state flags.
- [x] Commit: `git commit -m "feat: persist project edits with revisioned recovery"`.

### Task 4: File-backed snapshots and backing migration

**Files:** Create Studio `src/workspace/project-controller.ts`, `test/workspace/project-controller.test.ts`, `src/workspace/migrations/project-config.ts`, `test/workspace/project-config-migration.test.ts`; modify `src/shell/providers/WorkspaceProvider.tsx`, `src/workspace/workspace-manager.ts` and `src/shell/workbench-settings.ts` at activation/persistence boundaries.

**Interfaces:** Consume T1 normalization/T3 adapter. Produce `createProjectController(input:{workspaceId:string;adapter:ProjectFileAdapter;validateTarget:TargetValidator}):ProjectController`, where `ProjectController` has `load():Promise<ProjectSnapshot>`, `current():ProjectSnapshot|undefined`, `save(writes:readonly ProjectWrite[]):Promise<ProjectSnapshot>`, `dispose():void`. Invalid files retain the last valid snapshot and diagnostics; `save` rejects incomplete transactions. Migration produces a preview of `ProjectWrite[]`, not direct writes.

- [x] Write failing tests: load repository settings over stale IndexedDB; rejected invalid YAML retains last valid execution state; workspace disposal ignores late results; stale external edit prevents Save; migrate old target options only with explicit confirmation; ambiguous legacy floating bindings are unresolved rather than assigned a fabricated tag.
- [x] Run `pnpm --filter @rune-langium/studio test -- project-controller.test.ts project-config-migration.test.ts`; expect failure.
- [x] Implement controller activation/revision guards and explicit migration preview through T3 Save. Repository files win; do not delete browser preferences on failure or overwrite existing target names. Add an explicit project-settings Save action, leaving run drafts separate.
- [x] Rerun suites and existing `test/store/export-workbench-store.test.ts`; expect repository restoration plus existing request-identity tests to pass.
- [x] Commit: `git commit -m "feat: activate portable project snapshots in Studio"`.

### Task 5: Explicit headless local-project builds

**Files:** Create `packages/project-runtime/{package.json,tsconfig.json,vitest.config.ts,README.md}`, `src/{index,local-project,build-project,node-files}.ts`, `test/build-project.test.ts`; create CLI `src/build.ts`, `test/cli-build.test.ts`; modify CLI `src/index.ts`, `package.json`, lockfile and `docs/agents/architecture.md`.

**Interfaces:** Runtime consumes config, core and codegen without reverse dependencies. Produce `buildProject(snapshot:ProjectSnapshot,request:{targets:readonly string[]|'all'},adapter:ProjectFileAdapter):Promise<{status:'success'|'failed';diagnostics:ProjectDiagnostic[];outputs:readonly string[]}>`. Node adapter implements T3 with realpath containment. CLI produces `runBuild(options:{project:string;target?:string[];all?:boolean;json?:boolean}):Promise<number>` and command `rune-dsl build --project <root> --target <name...>` or `--all`.

- [ ] Write failing tests: no target and mutually supplied `--all`/`--target` exit 2; unknown/unavailable target writes nothing; two named SQL targets generate separately; multi-file `.rosetta` inputs link together; output symlink escape is refused; unresolved reference requests fail affected builds pending P2. Assert output bytes match direct codegen for the same parsed sources/options.
- [ ] Run `pnpm exec vitest run packages/project-runtime/test/build-project.test.ts packages/cli/test/cli-build.test.ts`; expect contract failures.
- [ ] Implement source discovery from configured globs and one shared parse/link graph, then call existing generate/selection contracts with explicit options. Node-only APIs live in node-files. Keep legacy CLI commands unchanged. Record toolchain mismatch before generation, never download arbitrary generators from YAML.
- [ ] Build config/core/codegen/runtime/CLI in dependency order, rerun suites and package types; expect pass. Read generated files and assert no protected files changed.
- [ ] Commit: `git commit -m "feat: build explicit named targets from project files"`.

### Task 6: Studio named targets, isolated run drafts and completion gate

**Files:** Modify Studio `src/{store/export-workbench-store.ts,services/export-request.ts,shell/panels/ExportSettingsPanel.tsx,shell/perspectives/screens/ExportPerspective.tsx,components/export-target-settings.ts}`; extend `test/store/export-workbench-store.test.ts`; create `test/e2e/project-targets.spec.ts`; update Studio README and `docs/agents/architecture.md`.

**Interfaces:** Consume `ProjectController` and shared generator validation. Add `selectedTargetName:string|undefined` as personal state; resolve its `BuildTarget` from the snapshot. Run draft remains existing `ExportConfig`; `saveTarget(name:string,draft:ExportConfig):Promise<ProjectSnapshot>` maps options into that named target through project Save. Never persist selection as a default target.

- [ ] Write failing store/browser tests: no saved target is auto-selected; switching between two SQL targets retains independent settings; YAML edit updates the target form; explicit Save survives reopen and CLI agrees; one-off root/option changes do not overwrite saved target; a stale generation result cannot be downloaded after file/lock changes.
- [ ] Run the focused store tests and `pnpm --filter @rune-langium/studio exec playwright test test/e2e/project-targets.spec.ts --project=chromium`; expect failures before integration.
- [ ] Implement named-target selection, explicit Save target settings, explicit multi-target/Build all controls and source/config/lock result invalidation. Reuse current controls and generation/cancel/error paths. Leave personal docking/active output in IndexedDB.
- [ ] Run the new journeys, existing export journeys, affected package tests/builds/types, lint, formatting and diff checks through normal hooks. Expect no default target, identical captured preview/download identity and file readback. Test documentation-only changes without unrelated runtime tests.
- [ ] Commit: `git commit -m "feat: share named project target settings with Studio exports"`. Present the P1 diff and acceptance evidence for review; P2 starts from its accepted interface, not from uncommitted task assumptions.
