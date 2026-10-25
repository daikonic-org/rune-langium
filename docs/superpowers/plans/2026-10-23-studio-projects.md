# Studio Projects and Launcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved launcher and portable examples, workflows and form presentation on the shared project foundation.

**Architecture:** Keep canonical shared records in repository files through ProjectController; retain ephemeral/personal browser state in existing stores. Workspace opening and read-only reference dependencies are separate tasks. Use current design-system primitives and the approved mockup rather than a new visual system.

**Tech Stack:** Existing TypeScript/React, Zustand, design-system controls, file adapters, Vitest, Playwright and shared project/codegen packages.

**Spec:** [Approved design](../specs/2026-10-23-portable-workspaces-reference-models-design.md); [mockup](../specs/2026-10-23-workspace-launcher/mockup.html); [P1](2026-10-23-workspace-foundation.md), [P2](2026-10-23-reference-resolution.md), [P3](2026-10-23-github-project-initialization.md).

## Global Constraints

All [index constraints](2026-10-23-portable-workspaces.md) apply. Shared form layouts are portable; personal panel layouts are not. Visible terminology is example, without gratuitous internal InstanceRecord renames. No standalone Maven action. One reference release per model. Starter projects are editable GitHub repos, not curated bundles. No repo creation/publication, push, merge or deployment without authorization.

## Review Focus

1. Hidden OPFS storage includes credentials and scratch data: T1 migrates only typed example records and never copies hidden trees.
2. A list item index is unstable across edits: T2 persists schema property paths, not DOM IDs or transient selection indices as layout identity.
3. Missing/changed reference types must preserve example payloads: T1/T2 report broken bindings without destructive migration.
4. Opening a public starter must not authorize pushing to its source: T3 separates provenance from writable Git backing.
5. UI says an implementation is ready but a curated caller still uses the original: T5 checks parsed execution and expected output through the effective graph.

### Task 1: Portable example records and safe migration

**Files:** Create project-config `src/examples.ts`, `test/examples.test.ts`; Studio `src/workspace/example-repository.ts`, `test/workspace/example-repository.test.ts`; modify `src/store/{instance-store,instance-persistence}.ts`, `src/opfs/instances-fs.ts`, `src/components/{InstanceCreateDialog,InstancePayloadPanel,WorkflowImport}.tsx`, corresponding UI copy, and existing instance OPFS/store tests.

**Interfaces:** Define `ExampleDescriptor={schemaVersion:1;id:string;name:string;type:SymbolIdentity;payload:string;codec:string;provenance?:{source:string};expected?:string}`. Produce `readExamples(snapshot:ProjectSnapshot):{examples:ExampleDescriptor[];diagnostics:ProjectDiagnostic[]}` and `saveExample(controller:ProjectController,example:ExampleDescriptor,payload:unknown):Promise<ProjectSnapshot>`. Codec lookup comes from shared registered capabilities; plain JSON remains the initial supported codec. Preserve stable IDs when adapting to current InstanceRecord.

- [ ] Write failures: save/reopen through repository files preserves payload and type; clone restores examples without IndexedDB; two records of the same type stay distinct; broken/missing type retains payload with diagnostics; codec mismatch or an unavailable Rune default serialization format refuses a false-success save; old `.studio/instances` migrates only after readback; token/scratch sentinels never occur in managed output paths or Git status candidates.
- [ ] Run project-config example tests, Studio example-repository tests and existing instance persistence/store suites; expect new-contract failures.
- [ ] Implement typed descriptor/data persistence through P1 transaction and migrate existing records by exact ID. Never enumerate/copy all hidden workspace files. Do not persist execution artifacts unless explicitly saved as an example/expected fixture. Change visible Create an instance/Instances/Import instances copy to Create example/Examples/Import examples while preserving internal public compatibility where unnecessary to rename.
- [ ] Rerun suites; inspect adapter readback and migration markers. Confirm failed conversion leaves legacy data untouched and repeat migration is idempotent.
- [ ] Commit: `git commit -m "feat: save examples as portable workspace files"`.

### Task 2: Named workflows and shared form/control presentation

**Files:** Create project-config `src/{workflows,presentation}.ts`, `test/workflows-presentation.test.ts`; Studio `src/workspace/workflow-repository.ts`, `test/workspace/workflow-repository.test.ts`; modify `src/store/form-presentation-store.ts`, `src/shell/panels/PrototypeWorkflow.tsx`, `src/components/FormPresentation.tsx`, numeric/temporal formatting adapters at their existing seams, and `test/store/form-presentation-store.test.ts`.

**Interfaces:** Define `WorkflowBinding={kind:'example';exampleId:string}|{kind:'literal';value:unknown}` and `WorkflowDescriptor={schemaVersion:1;id:string;name:string;function?:SymbolIdentity;inputs:Record<string,WorkflowBinding>;outputs:Record<string,{name:string;type?:SymbolIdentity}>}`. Define `PresentationDescriptor={schemaVersion:1;type:SymbolIdentity;fields:Record<string,{order?:number;span?:number;format?:{kind:string;currency?:string;precision?:number;grouping?:boolean}}>;columns?:number}`. Produce `saveWorkflow(controller:ProjectController,workflow:WorkflowDescriptor):Promise<ProjectSnapshot>` and `savePresentation(controller:ProjectController,presentation:PresentationDescriptor):Promise<ProjectSnapshot>`, with corresponding pure readers in project-config.

- [ ] Write failures: optional no-function workflow round-trips input→payload; multiple input/example bindings survive reopen; result is transient until explicitly saved; object layout/primitive monetary format survive clone; formatting does not round semantic values; schema paths survive list edits; missing symbols return diagnostics without dropping data. Assert docking/filter/selection state is absent from shared files.
- [ ] Run config workflow/presentation and Studio repository/presentation-store suites; expect failures.
- [ ] Implement shared file readers/writers using P1 controller. Keep scratch workflows and view mode local. Adapt existing drag/drop layout editing to stable canonical symbol/property paths; retain current numeric/schema validation authority. Migrate browser presentation only when repository files are absent and the user accepts preview.
- [ ] Rerun suites and existing form-presentation/Prototype browser journeys. Verify actual saved files and untouched numerical payload values.
- [ ] Commit: `git commit -m "feat: persist named workflows and shared form presentation"`.

### Task 3: Workspace launcher and editable starter opening

**Files:** Create Studio `src/services/starter-registry.ts`, `src/components/StarterWorkspacePicker.tsx`, `src/workspace/open-starter.ts`, `test/services/starter-registry.test.ts`, `test/components/StarterWorkspacePicker.test.tsx`; modify `src/shell/perspectives/screens/WorkspacesPerspective.tsx`, `src/components/{FileLoader,WorkspaceSwitcher,GitHubWorkspaceFlow}.tsx`; create `test/e2e/workspace-launcher.spec.ts`.

**Interfaces:** Define `StarterProject={id:string;name:string;description:string;repository:string;ref:string;examples:readonly string[];requiredCapabilities:readonly string[];status:'available'|'unavailable'}`. Produce `listStarterProjects():readonly StarterProject[]` from a reviewed catalog and `openStarter(input:{starter:StarterProject;signal:AbortSignal}):Promise<{workspaceId:string;provenance:{repository:string;commit:string}}>` via injected source/file adapters. Catalog display metadata does not substitute for checked repository contents.

- [ ] Write failures: compact recents/open controls remain accessible; starter search/detail has empty/loading/error states; public starter opens editable without login; reference-only flag is never assigned; provenance does not become a writable push remote; explicit clone/fork/connect is required before commit/push; unavailable starter publication is disclosed; no Import Maven action exists.
- [ ] Run component/service suites and `pnpm --filter @rune-langium/studio exec playwright test test/e2e/workspace-launcher.spec.ts --project=chromium`; expect failures.
- [ ] Implement the approved list/detail composition with shared Button/Field/Combobox and current brand SVG/tokens. Keep New workspace/Open folder/Open GitHub and existing file import. Wire post-GitHub-open to P3, not a separate Maven control. Start-from-example creates an editable file-backed working copy with provenance. Use deterministic repository fixtures for tests; proposed daikonic-org starter names remain unavailable until their real repos are authorized, created and verified.
- [ ] Rerun suites at 1440×960 and 390×844 with keyboard navigation, narrow Back, long repository names, focus visibility and Axe. Check no horizontal overflow, lost selection, accidental clone/push or state loss. Confirm the design-system dropdown chrome matches existing controls.
- [ ] Commit: `git commit -m "feat: separate workspace and starter project launching"`.

### Task 4: Reference model settings and release-change review

**Files:** Create Studio `src/components/{ReferenceModelPicker,ReferenceReleaseReview}.tsx`, `test/components/ReferenceModelPicker.test.tsx`, `test/e2e/reference-release-selection.spec.ts`; modify `src/components/ModelLoader.tsx`, workspace settings/navigation and `src/services/project-references.ts`; update Studio docs and current product context.

**Interfaces:** Consume P2 catalogs, lock and resolve/load APIs plus P1 controller. `ReferenceReleaseReview` receives proposed `{config:BuildConfig;lock:ProjectLock;diagnostics:ProjectDiagnostic[]}` and accepts/cancels without mutating the active project until P1 Save succeeds. Display model/release names, not cohort IDs.

- [ ] Write failures: add reference selects exact release; transitive required dependencies explain origin; same-model second version is refused; upgrade previews compatibility impacts and can cancel; invalid/missing lock, offline cache miss and hash failure show distinct recovery; async failure leaves old reference usable; no latest fallback; narrow drill-in/Back preserves selection.
- [ ] Run picker tests and release-selection journeys; expect failures.
- [ ] Implement separate reference settings with searchable model list, release picker, compatible closure and explicit Add/Change review. Preserve original model loading/hydration through P2 adapters. Show pending/verified/conflict/unavailable distinctly and gate affected operations until their receipts agree. Keep active-workspace summary compact; do not return curated actions to the workspace-opening list.
- [ ] Rerun journeys with real tiny serialized cohort fixtures and browser-cache readback. Verify two workspaces retain different locks after switches; run keyboard/Axe/viewport checks and affected tests/types/builds.
- [ ] Commit: `git commit -m "feat: select pinned reference releases per workspace"`.

### Task 5: Rune-first implementation fixture and end-to-end completion

**Files:** Create runtime `test/fixtures/implementations/{reference,local}.rosetta`, `test/fixtures/implementations/{build-config.yml,studio-config.yml}`, `test/project-implementation.test.ts`; create Studio `test/e2e/project-example-workflow.spec.ts`; add starter content under `examples/workspaces/model-authoring/` with license/readme/config/example/expected fixture files; update root/Studio/package docs and relevant architecture guidance.

**Interfaces:** Consume P2 explicit implementation/declaration overrides and P4 example/workflow writers. The deterministic fixture has a reference `Double` function with required numeric input/output and no implementation, a local Rune replacement with the same signature computing `value * 2`, and a reference caller that invokes the original identity. No new Rune syntax or native implementation is introduced. This fixture proves project wiring, not CDM business parity.

- [ ] Write failing parsed execution tests: input `10` produces `20` through the reference caller; missing required input is rejected; the project clone/reopen preserves the override and example; removing its mapping makes the implementation unavailable again. Browser journey saves an input example, binds it to the function, executes, saves output as another example, reopens and checks payload plus shared formatting.
- [ ] Run runtime fixture tests and `project-example-workflow.spec.ts`; expect fixture/integration failures.
- [ ] Add the Rune-first fixture and local starter content, with expected output and provenance. Inventory pinned CDM/FpML provider requirements as explicit capability gaps; do not mark schedules, external observations, decimal parity or calendars implemented. Remote starter publication remains a separate authorized step after these files pass.
- [ ] Run the full affected-package checks and normal workspace types/hooks, plus launcher/reference/project-target/override/example journeys. Verify repository-managed files contain no credentials/personal state and that expected fixtures are tracked while generated/exports are ignored. If deployed testing is later requested, verify the deployed commit and real service results separately.
- [ ] Commit: `git commit -m "test: verify portable example workflows with Rune overrides"`. Present the completed slices, actual test results and remaining capability/publication limits; do not merge or deploy automatically.
