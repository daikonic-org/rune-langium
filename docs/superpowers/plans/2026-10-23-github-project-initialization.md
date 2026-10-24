# GitHub Project Initialization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Initialize portable settings from a repository's existing POM when GitHub-open finds no build-config, with a useful compatibility report.

**Architecture:** Detection is part of repository activation. A static, host-neutral adapter proposes configuration writes and capability requirements; Studio previews and commits them through P1 Save. Existing companion configuration always wins.

**Tech Stack:** Existing TypeScript, Vitest, Git-backed file adapter and React; a non-executing XML parser configured without external entity resolution. Use the existing repo XML dependency if suitable; otherwise select/pin one in the adapter task.

**Spec:** [Approved design](../specs/2026-10-23-portable-workspaces-reference-models-design.md), as clarified by the user: no standalone Maven import button; detection belongs to GitHub import.

## Global Constraints

All [index constraints](2026-10-23-portable-workspaces.md) apply. Maven import only; never invoke Maven/plugins, generate a POM or synchronize back. POM remains unchanged. Partial initialization creates editable files with affected capabilities unavailable. Public inspection does not require authentication or authorize push.

## Review Focus

1. A repo already containing build-config must not reapply POM settings: T2.
2. Parents/properties/profiles may be unresolved or cyclic: T1 reports them with origin rather than guessing browser environment.
3. Clone succeeds but initialization fails: T2 preserves the editable workspace and report without inventing success.
4. Unsupported lifecycle steps may invalidate only one generator: T1/T3 identify exact affected targets.
5. User cancels or edits files during preview: T2 uses revision preconditions and never overwrites the newer working copy.

### Task 1: Static repository metadata adapter

**Files:** Create project-config `src/import/{maven,report}.ts`, `test/maven-import.test.ts`, `test/fixtures/maven/{minimal,profiles,unresolved-parent,unknown-plugin}.xml`; create runtime `src/import/rune-maven-adapters.ts`, `test/rune-maven-adapters.test.ts`; add pinned CDM/FpML metadata fixtures with source commit/license notes under `test/fixtures/third-party/project-import/`.

**Interfaces:** Produce `ImportReportItem={code:string;path:string;message:string;status:'translated'|'unresolved'|'unsupported';targets:string[];capabilities:string[]}`; `MavenImportPreview={build:BuildConfig;report:ImportReportItem[];provenance:{pomPath:string;profiles:string[]};writes:ProjectWrite[]}`; `inspectMavenProject(files:ProjectFiles,input:{pomPath:string;profiles:readonly string[]}):MavenImportPreview`. Runtime `mapMavenReferences(preview:MavenImportPreview,catalog:ReferenceCatalog):MavenImportPreview` uses explicit artifact/tag mappings, not semver guesses.

- [ ] Add failing tests for static property interpolation/parent inheritance/dependency management, explicit profiles, unresolved OS/JDK/settings activation, plugin executions → distinct named targets, unsupported filtering, unknown plugins and absent native implementations. Assert a DOCTYPE/external entity is rejected without network access; namespace-qualified XML and parent cycles return diagnostics. Verify fixtures include exact upstream coordinates/source paths and original POM bytes survive.
- [ ] Run `pnpm --filter @rune-langium/project-config test -- maven-import.test.ts` and runtime adapter tests; expect new-interface failures.
- [ ] Implement a bounded static resolver with origin tracking. Profile selection is input; no ambient environment activation. Use known Rune/CDM/FpML adapters keyed by plugin/metadata version for target/resource mappings; retain unknown coordinates as unresolved report items. Put generated settings only into the proposed writes, never write directly.
- [ ] Rerun suites; assert a partial import remains a valid editable project and translated targets contain no default. Validate every fixture against pinned source metadata, not live latest files.
- [ ] Commit: `git commit -m "feat: inspect Maven project metadata for GitHub initialization"`.

### Task 2: Detection and review inside GitHub-open

**Files:** Create Studio `src/workspace/project-initialization.ts`, `src/components/ProjectInitializationReview.tsx`, `test/workspace/project-initialization.test.ts`, `test/components/ProjectInitializationReview.test.tsx`; modify `src/components/GitHubWorkspaceFlow.tsx`, `src/shell/providers/WorkspaceProvider.tsx` at post-open activation. Keep transport/clone concerns in current services.

**Interfaces:** Consume P1 controller and T1 preview. Produce `detectProjectInitialization(files:ProjectFiles):{kind:'configured'}|{kind:'maven';pomPath:string}|{kind:'plain'}` and `prepareGitHubInitialization(snapshot:ProjectSnapshot,profiles:readonly string[]):Promise<MavenImportPreview>`. A confirmed preview is applied using `ProjectController.save(preview.writes)`; cancellation writes nothing.

- [ ] Write failures: configured `.yml` and `.yaml` skip POM; ambiguous companion spelling is diagnosed rather than overwritten; a plain repo opens normally; Maven repo shows detected settings/profiles/report within GitHub-open; cancel leaves POM/files unchanged; Save conflict preserves both preview and newer files; initialization failure does not delete a successfully opened workspace.
- [ ] Run focused Studio component/workspace tests; expect failures.
- [ ] Implement post-open detection and an inline review step with explicit Initialize project settings/Keep browsing actions. Existing settings remain authoritative. Clone/open readiness and initialization capability status are separate. Do not introduce Import Maven anywhere in launcher/navigation or a Maven-specific top-level dialog.
- [ ] Rerun suites and existing `GitHubWorkspaceFlow.test.tsx`/workspace manager tests. Assert POM bytes and Git remote/branch identity are unchanged.
- [ ] Commit: `git commit -m "feat: initialize detected build settings during GitHub open"`.

### Task 3: Partial capability UX and real repository journeys

**Files:** Create Studio `test/e2e/github-project-initialization.spec.ts`, runtime `test/maven-project-capabilities.test.ts`; modify initialization review, target-status and function-status views only at existing capability display seams; update Studio README and project-config importer docs.

**Interfaces:** Consume P2 `Capability[]` and T1 `ImportReportItem[]`. UI reports translated settings and recovery per affected target/function; it must not evaluate success from import completion alone.

- [ ] Write failures for a CDM/FpML fixture import with an unsupported Java provider, two plugin executions where only one is unavailable, repair with a local explicit implementation, reopening from generated build-config without reimport, and zero buttons named Import Maven. Assert pure type generation still works and a missing schedule implementation cannot Execute.
- [ ] Run runtime capability tests and `pnpm --filter @rune-langium/studio exec playwright test test/e2e/github-project-initialization.spec.ts --project=chromium`; expect failures.
- [ ] Connect reports to shared capabilities and recovery controls. Keep POM evidence readable, preserve selected profiles, and use explicit retry/review rather than hidden POM synchronization. Do not request secrets or call real repository publication during tests.
- [ ] Rerun journeys plus types/build/lint/format checks for affected packages; expect file readbacks, disabled affected capabilities and no standalone Maven entry point.
- [ ] Commit: `git commit -m "feat: expose partial GitHub project initialization reports"`. Present P3 acceptance evidence.
