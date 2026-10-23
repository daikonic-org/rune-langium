# Reference Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve pinned model releases and explicit local overrides identically across language services, builds and previews.

**Architecture:** Extend curated-schema/catalog publication rather than introducing another artifact format. Project-runtime owns lock resolution and composes one effective graph; core exposes an injected declaration-resolution port and remains independent of project packages.

**Tech Stack:** Existing TypeScript, Zod, Langium, curated immutable cohorts, Vitest and browser/hosted workers.

**Spec:** [Approved design](../specs/2026-10-23-portable-workspaces-reference-models-design.md); [P1 contracts](2026-10-23-workspace-foundation.md).

## Global Constraints

All [index constraints](2026-10-23-portable-workspaces.md) apply. One release per reference model per workspace; locked opens never float to latest. Never mutate immutable reference artifacts. Explicit mappings include model/namespace/kind/name/dispatch; no name-only shadowing. All consumers use the effective graph. No release publishing/deployment without separate authorization.

## Review Focus

1. A moved GitHub tag must not replace locked content: T1/T2 pin commit and hash, even when catalog metadata changes.
2. An aborted upgrade must preserve old reference bytes and mapping validity: T2 publishes only a verified complete closure.
3. Function/enum/type names can collide: T3 keys include kind and owning model.
4. Hydrated references may already point to old AST nodes: T3/T4 build a fresh graph and test curated callers, not just name lookup.
5. A missing calendar/code-list provider is unavailable, not valid empty data: T5 gates exact capabilities separately from type generation.

### Task 1: Release catalog and immutable release mappings

**Files:** Create curated-schema `src/release-catalog.ts`, `tests/release-catalog.test.ts`; modify `src/index.ts`; create `scripts/lib/curated-releases.mjs`, `scripts/lib/curated-releases.test.mjs`; modify `scripts/upload-serialized-artifacts.sh`, mirror `src/http.ts`, `test/http.test.ts` and curated publishing docs.

**Interfaces:** Produce `ReferenceRelease={modelId:string;repository:string;tag:string;commit:string;manifest:string;cohort:string;checksum:string;dependencies:Record<string,{modelId:string;release:string}>;toolchain:string}` and `ReferenceCatalog={schemaVersion:1;releases:ReferenceRelease[]}`. Produce `validateReferenceCatalog(input:unknown):ReferenceCatalog` from shared Zod schemas. Expose read-only `GET /releases/<modelId>` using the same mirror CORS/errors conventions; catalog publication follows immutable artifact upload.

- [ ] Write failing tests: release commit/hash mapping survives JSON round-trip; catalog points only to fully published cohorts; interrupted dependency publication does not advance a release mapping; latest and release identities are distinct; missing release returns an honest unavailable response.
- [ ] Run `pnpm --filter @rune-langium/curated-schema test -- release-catalog.test.ts`, `node --test scripts/lib/curated-releases.test.mjs`, and mirror HTTP tests; expect failures.
- [ ] Implement shared release metadata validation and dry-run publication preparation. Reuse source selection, namespace graphs and cohort hashing from the existing publisher. Resolve known CDM/FpML dependencies from pinned upstream metadata; do not infer Git tags from artifact version strings without an adapter mapping. No live upload during tests.
- [ ] Rerun suites plus existing `node --test scripts/lib/curated-sources.test.mjs scripts/upload-serialized-artifacts.test.mjs`; expect all publication ordering/failure guards to pass.
- [ ] Commit: `git commit -m "feat: describe immutable curated release catalogs"`.

### Task 2: Complete locked dependency resolution

**Files:** Create runtime `src/references/{resolve,load,cache}.ts`, `test/reference-resolution.test.ts`; modify config lock validation and runtime `src/index.ts`; adapt Studio `src/services/curated-fetch.ts` through a new `src/services/project-references.ts`, with `test/services/project-references.test.ts`.

**Interfaces:** Consume P1 `ProjectSnapshot`, `ProjectLock`, P2/T1 `ReferenceCatalog`. Define injected `ReferenceTransport={catalog(modelId:string,signal:AbortSignal):Promise<ReferenceCatalog>;artifact(url:string,signal:AbortSignal):Promise<Uint8Array>}` and verified `ReferenceCache={get(checksum:string):Promise<Uint8Array|undefined>;put(checksum:string,bytes:Uint8Array):Promise<void>}`. Produce `resolveProjectReferences(snapshot:ProjectSnapshot,transport:ReferenceTransport,signal:AbortSignal):Promise<{lock?:ProjectLock;diagnostics:ProjectDiagnostic[]}>` and `loadLockedReferences(lock:ProjectLock,transport:ReferenceTransport,cache:ReferenceCache,signal:AbortSignal):Promise<{documents:readonly {uri:string;content:string;serialized?:string}[];diagnostics:ProjectDiagnostic[]}>`.

- [ ] Write failing tests for offline cache hit/miss, hash mismatch, incompatible direct/transitive versions, moved tags, missing manifest, different workspace pins and canceled/stale upgrades. Assert one model version in every closure and no publication of partial results; existing lock opens require no latest lookup.
- [ ] Run `pnpm --filter @rune-langium/project-runtime test -- reference-resolution.test.ts` and Studio project-reference tests; expect failures.
- [ ] Implement closure selection using catalog dependency edges and current cohort loader/hydrator contracts. Hash bytes before cache promotion, compare config digest and preserve existing lock provenance. An explicit resolve/upgrade proposes config+lock writes through P1 Save; ordinary open only verifies/loads locked content. Guard results by workspace/revision and AbortSignal.
- [ ] Rerun tests plus existing curated cache/cohort tests; expect pass. Confirm unknown releases never fetch latest as fallback and interrupted upgrade leaves the old snapshot usable.
- [ ] Commit: `git commit -m "feat: resolve locked reference model closures"`.

### Task 3: Core declaration redirect contract and effective graph

**Files:** Create core `src/references/project-resolution.ts`, `test/services/project-resolution.test.ts`; modify `src/services/{rune-dsl-linker,rune-dsl-scope-provider,rune-dsl-module}.ts` and core public exports. Create runtime `src/{effective-project,override-validation}.ts`, `test/effective-project.test.ts`.

**Interfaces:** Core produces `DeclarationIdentity` with the same structural fields as P1 `SymbolIdentity`, `declarationKey(identity:DeclarationIdentity):string`, `DeclarationRedirects={resolve(identity:DeclarationIdentity):DeclarationIdentity}` and `setProjectRedirects(services:RuneDslServices,redirects:DeclarationRedirects):void`. Runtime produces `buildEffectiveProject(snapshot:ProjectSnapshot,referenceDocuments:readonly {uri:string;content:string;serialized?:string}[]):Promise<{services:RuneDslServices;documents:readonly LangiumDocument[];receipt:{revision:string;lockDigest:string;overridesDigest:string};diagnostics:ProjectDiagnostic[]}>`.

- [ ] Write failing parsed Rune fixtures: same-name function/type/enum resolve separately; mapped function is called from curated source; copied self-reference resolves locally; dispatch base/variants stay one family; signature mismatch, mapping cycle and missing destination produce errors. Assert original cached artifact bytes/objects are unchanged.
- [ ] Run core project-resolution and runtime effective-project tests; expect failures before linking integration.
- [ ] Implement identity redirects at authoritative scope/link boundaries before references settle. Construct one fresh graph, register roots before revival and build/link in batch, reusing core's hydrator. Validate all override endpoints and function signature/cardinality compatibility. Do not intercept codegen names separately or mutate a cached generation's AST.
- [ ] Rerun fixtures and existing core hydration/scoping/dispatch tests; expect exact target object identity across transitive references and no missing-original fallback.
- [ ] Commit: `git commit -m "feat: resolve explicit project declaration overrides"`.

### Task 4: Effective project integration and declaration copy Save

**Files:** Modify runtime `src/build-project.ts`; Studio `src/services/{workspace,local-declaration,codegen-service,export-request}.ts`, `src/shell/providers/{WorkspaceProvider,CodegenProvider}.tsx`; add shared worker project request/receipt fields at the existing message contracts; update LSP `src/document-update-handler.ts`, hosted `apps/lsp-worker/src/{session,model-storage}.ts`; create integration tests in runtime, Studio and LSP, and Studio `test/e2e/project-overrides.spec.ts`.

**Interfaces:** Consume `buildEffectiveProject` and its receipt; generation/preview requests include `{revision,lockDigest,overridesDigest}`. Extend existing workspace synchronization to carry versioned project configuration/lock/override data; the server acknowledges the applied receipt. Produce Studio `modifyProjectDeclaration(request:LocalDeclarationRequest,controller:ProjectController):Promise<ProjectSnapshot>` using existing copy preparation plus one atomic logical Save of copied source and the explicit map.

- [ ] Write failures proving local, browser worker, hosted diagnostics and generated execution all use a replacement reached through a curated caller; stale worker/LSP receipts cannot establish ready status; Modify preserves documentation/annotations/imports/dispatch and repeated Modify opens the same local copy; Extend does not redirect. Assert no standalone original-identity source export is offered before materialization exists.
- [ ] Run focused runtime, Studio and LSP integration suites plus `project-overrides.spec.ts`; expect failures.
- [ ] Integrate effective graph construction and receipt validation into each host adapter. Do not import runtime from core/codegen or add browser LSP fallback. Save copied logical declaration and mapping via P1 transaction; use source slices from existing local-declaration code. Update `apps/studio/PRODUCT.md` because curated callers now honor explicit replacements. Gate affected operations while hosted resolution is stale/unavailable.
- [ ] Rerun integration and existing curated navigation/hydration/export/preview journeys. Verify actual emitted module result and exact linked target, not only UI badges. Expect all to agree; unsupported raw source materialization remains explicitly disabled.
- [ ] Commit: `git commit -m "feat: apply project overrides across Studio and language services"`.

### Task 5: Resource and implementation capability resolution

**Files:** Create runtime `src/{resources,capabilities,implementations}.ts`, `test/project-capabilities.test.ts`; modify codegen runtime-binding seam through a new `src/runtime/project-bindings.ts` and matching tests; adapt Studio validation/form choice providers at their existing codegen-schema consumption points; update project runtime docs.

**Interfaces:** Define `ImplementationProvider={id:string;supports(symbol:SymbolIdentity):boolean;invoke(args:readonly unknown[]):unknown}` and `Capability={id:string;status:'available'|'unavailable';reason?:string;affectedTargets:string[];affectedFunctions:SymbolIdentity[]}`. Produce `resolveProjectCapabilities(snapshot:ProjectSnapshot,providers:readonly ImplementationProvider[]):Capability[]` and `resolveProjectResource(snapshot:ProjectSnapshot,source:{model:string;id:string}):{path:string;checksum?:string}|ProjectDiagnostic`. Browser/core/codegen consumers receive resolved bindings, not config parsers.

- [ ] Write failures: explicit code-list resource changes both validation and form choices; unmapped local same-name file does not shadow; missing holiday provider is unavailable rather than empty/valid; missing function implementation leaves pure type generation usable; unsupported codec cannot claim successful serialization.
- [ ] Run runtime capability tests and codegen binding tests; expect failures.
- [ ] Implement registered provider/resource resolution with stable symbol/resource identities, using the same registry for validation, execution and preview schema choices. Bind only installed/trusted implementations, never execute arbitrary repository JavaScript or POM plugins. Preserve source resource bytes and provenance. Initial generated Rune calls remain synchronous: prepare external data before execution or report the async provider unsupported; never return a Promise where the generated function expects a value.
- [ ] Rerun tests and verify capability reports identify exactly affected targets/functions. Run affected packages' normal lint/build/type checks; no live calendar/network provider is required for deterministic fixture tests.
- [ ] Commit: `git commit -m "feat: report project resource and implementation capabilities"`. Present P2 evidence before dependent UI claims support.
