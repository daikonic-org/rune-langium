# Shared Inspector Constructs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete #562 with one authoritative editor per shared construct and a bottom pane for the selected child's metadata, retaining correct edits and source.

**Architecture:** Keep each declaration's existing canonical form, schema validation and graph/source pipeline. Add guarded child targets and shared metadata bindings, then compose the five forms and read-only surfaces through a common Inspector frame. Member basics stay inline; the lower pane shares the same form and edits documentation, annotations, synonyms and enum-value display names.

**Tech Stack:** TypeScript, React, React Hook Form, canonical generated Zod schemas, existing zod-to-form SectionRenderer/row registry, zustand/Mutative/zundo, Base UI design-system primitives, Vitest and Playwright. Keep installed dependency versions and optimization policy unchanged.

**Spec:** [Approved shared-constructs design](../specs/2026-10-11-inspector-shared-constructs-design.md).

**Added issue:** [#595 — wrong curated Source after on-demand hydration](https://github.com/pradeepmouli/rune-langium/issues/595). Task 0 fixes this existing Explore navigation boundary before the Inspector host integration. It is independently testable and can ship in its own commit; Tasks 1–10 retain their original responsibilities.

**Planning baseline:** `da3987a9cecd9e6129e33aa8663ac666707e7e77`, branch `codex/inspector-shared-constructs`, attached checkout `/Users/pmouli/.codex/worktrees/dependency-merge-573/rune-langium`. Execution remains inline as previously requested; a fresh whole-branch review follows implementation. The user approved execution on 2026-10-12.

## Execution progress (2026-10-12)

- Integrated fresh `origin/master` at `8e09f2d4`; preserved dirty agent documents and `.resources`.
- Task 0 completed locally: the stable-path hydration fixture fails with the original effect and passes with the corrected document routing. Source integration uses two real serialized documents and confirms full-file read-only function reveal. All 94 scoped Studio tests and Studio type checks pass. Production J20 now checks visible declaration reveal; production execution is pending an authorized deployment.
- Task 1 complete: regenerated projected canonical metadata fields, shared schema lookup and owner/epoch/child guards; 20 metadata/L1/parity tests and visual-editor types pass.
- Task 2 complete: canonical factories and guarded metadata commands share the existing mutateGraph/undo/reconcile path; root actions delegate. 56 store tests and 33 additional shared-section/reparse checks pass; types/lint pass.
- Task 3 foundations complete: stable row/locator aliases, captured edit envelopes, existing timer flush and callback registry. 25 selection/debounce/L1 checks pass; actual-form integration remains in Tasks 4/6/7. Root-level timers outside the returned provider use its additionalCommitFlush prop.
- Remaining Tasks 4–10 are pending. Run scoped Vitest via `pnpm --filter <package> exec vitest run <files>`; an extra `--` through the package test script causes this Vitest version to run the entire suite.

## Global Constraints

- Each declaration retains one canonical form state and provider.
- Name, type and cardinality stay directly editable in each applicable row, using the existing controls.
- Enum-value display names/labels belong in details, bound to canonical `display`; value names stay inline and no new `labels` property is introduced.
- Curated declaration navigation must select its authoritative source document and reveal the declaration after hydration or cached reload. Preserve lazy active-namespace source loading and existing immutable artifact caches; namespace identity is not a document identity.
- Authored comments remain editable in the Source editor and existing code-region editors.
- No new persisted IDs or global child-identity store are required.
- Existing public standalone section and row callback APIs remain supported as thin bindings to the canonical components.
- Retain the persistence debounce and workspace save barrier; do not add a second timer or a new Save button.
- LOC remains supporting evidence, not an acceptance threshold.
- Do not delete or migrate existing stored notes or remove their public API solely for consolidation.
- No product dependency or storage-format changes; no L2/Zod compilation adoption; no expression-semantics redesign.
- Preserve dirty `.claude/CLAUDE.md`, `GEMINI.md`, `.resources`, the primary checkout and user browser tabs. Stage only owned files. New package source uses MIT SPDX; Studio source uses FSL-1.1-ALv2.
- Use the manifest-supported Node range `^22.22.2 || ^24.15.0 || >=26.0.0` and pinned `pnpm@11.5.0`; regenerate authoritative inputs rather than editing generated files.

## Review Focus

1. A pending debounced edit followed by selection, rename, reorder, delete/name reuse or workspace change must never update the replacement child. Tasks 1, 3 and 9 pin this.
2. Source reparsing between two metadata edits must retain both edits and correct ownership; array indices cannot become persistent identities. Tasks 2 and 8 pin this.
3. Rich annotations, cross-namespace synonyms, code comments, CRLF and non-BMP text must survive structural edits and round-trip. Tasks 2, 4 and 8 pin this.
4. An inherited, curated or unsupported metadata target must remain inspectable without mutating a base declaration or hiding an invalid draft. Curated navigation must also keep Source on the selected declaration when several files share a namespace, even after delayed hydration or reload. Tasks 0, 4, 6, 7 and 9 pin this.
5. Empty selection, large/paginated enums and narrow panels must preserve accessible row editing, useful pane sizes and live function/condition editing sessions. Tasks 5, 6, 7 and 9 pin this.

## File structure and responsibilities

| Files                                                                                                              | Responsibility                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `src/schemas/editor-field-schema.ts`                                                                               | Extract the existing canonical schema path resolver; no new constraint implementation and no React dependency. |
| `src/store/metadata-target.ts`                                                                                     | Typed target paths, capture/resolve guards and canonical metadata capability lookup.                           |
| `src/store/metadata-ops.ts`                                                                                        | Pure canonical annotation/synonym construction and validated metadata recipes.                                 |
| `src/store/editor-store.ts`, `src/types.ts`, `src/model.ts`                                                        | Wire recipes through existing mutation/undo/reconciliation and expose additive metadata capabilities.          |
| `src/components/forms/metadata/useInspectorSelection.ts`                                                           | Form-local row identity and current-path mapping, cleared at owner/scope boundaries.                           |
| `src/components/forms/metadata/MetadataTargetContext.tsx`                                                          | Bind the selected/root target to the existing form and guarded callbacks.                                      |
| `src/components/editors/SynonymEditor.tsx`                                                                         | One synonym interaction for typed canonical variants.                                                          |
| Existing AnnotationSection, MetadataSection and EnumValueRow                                                       | Delegate through the shared target/context and synonym editor; preserve standalone APIs.                       |
| `src/components/editors/inspector/InspectorFrame.tsx`, `InspectorDetailsPane.tsx`, `InspectorInheritanceField.tsx` | Shared header/footer/navigation composition, lower-pane interaction and parent selector presentation.          |
| Five EditorForms, OtherForm, EditorFormPanel and row registry                                                      | Supply kind-specific sections/bindings and reuse the common constructs.                                        |
| `packages/core/src/api/source-comments.ts`                                                                         | Comment token ranges from the existing canonical lexer and shared services.                                    |
| `src/serialize/source-trivia.ts`, existing CST renderer/source hook                                                | Retain source-owned comment trivia through structural child edits.                                             |
| `apps/studio/src/shell/ExplorePerspective.tsx`                                                                     | Supply existing workspace scope, guarded metadata actions and honest host status.                              |

Paths beginning `src/` in this table are under `packages/visual-editor/`. Test tasks below use full repository paths. These units form one Inspector change; source fidelity and persistence checks are its acceptance seams, not independent subsystem rewrites.

Task 0 additionally modifies `apps/studio/src/shell/explore-file-nav-store.ts` and existing Explore source/reveal effects to resolve exact curated document identity through current navigation state. It does not add a navigation store or replace source/cache services.

`src/hooks/editor-commit-lifecycle.tsx` collects flush callbacks for existing form timers. The existing useAutoSave, EditorFormProvider, source-sync hook and App save barrier consume those callbacks; no second timer or model store is introduced.

### Task 0: Curated source ownership and declaration reveal (#595)

**Files:** Modify `apps/studio/src/shell/explore-file-nav-store.ts`, `apps/studio/src/shell/ExplorePerspective.tsx`; extend `apps/studio/test/store/explore-file-nav-store.test.ts`, `apps/studio/test/pages/EditorPage.test.tsx`, `apps/studio/test/integration/curated-source-editor.test.tsx`, `apps/studio/test/prod-ux/journeys/j04-explorer-hydration.spec.ts` and `apps/studio/test/prod-ux/journeys/j20-curated-cache.spec.ts`. Update navigation architecture notes in Task 10. Keep source fetching/cache services unchanged unless a regression test proves a gap there.

**Evidence boundary:** Issue #595 reports J04a/J04b/J20 failures on both attempts of nightly run `38206165327`, with deployment freshness recorded at master `a0d0a148`. That is issue-supplied production evidence, not a fresh checkout performed while writing this plan. Direct inspection of this branch confirms the hydration effect ignores `pending.path` when choosing the first matching bundle/namespace/artifact file. Deferred exports can aggregate onto the first namespace document, so an exact-old-path check alone is not a complete fix. J20's declaration reveal symptom must be tested independently rather than presumed to share the file-selection cause.

**Interfaces:** Reuse `resolveEditorFilePath`, `nodeIdToFilePath` from current resolved model ownership, `expressionOwnerFiles` from canonical function dispatch ownership, `resolveNodeFile`, `findDeclarationLine`, `applyPendingReveal`, existing `SourceRevealRequest` and `useExploreFileNavStore`. Add the pure resolver below in `explore-file-nav-store.ts`, rather than a second file or navigation store. Extend the existing ephemeral pending request with current workspace/selection/navigation identity; validate that identity in the existing effect before calling the resolver. No persisted navigation or AST state is added.

```ts
export interface HydratedSourceRequest {
  bundleId: string;
  bundleVersion: string;
  namespace: string;
  path: string;
  nodeId?: string; // Declaration navigation when present; explicit file navigation otherwise.
  artifactKey?: string;
}

export function resolveHydratedSourcePath(
  request: HydratedSourceRequest,
  files: readonly WorkspaceFile[],
  hydratedNamespaces: readonly string[],
  resolvedDeclarationPath?: string
): string | undefined {
  const desired = request.nodeId ? resolvedDeclarationPath : request.path;
  const path = resolveEditorFilePath(desired, files);
  const file = path ? files.find((candidate) => candidate.path === path) : undefined;
  if (
    !file?.refOnly ||
    file.bundleId !== request.bundleId ||
    file.bundleVersion !== request.bundleVersion ||
    file.namespace !== request.namespace ||
    (request.artifactKey !== undefined && file.artifactKey !== request.artifactKey)
  )
    return undefined;
  return file.artifactKey || hydratedNamespaces.includes(request.namespace) ? file.path : undefined;
}
```

`resolvedDeclarationPath` must come from hydrated models/document ownership, not a namespace catalogue fallback. Before authoritative ownership exists, declaration routing waits. Exact file requests resolve only their requested identity. The existing parser/editor alias mapping handles `cdm/models/...` versus `[cdm]/models/...`; same basenames in another bundle are not fallbacks. Legacy hydrated namespaces without artifact keys retain their existing lazy source behavior. Before implementation, refresh `origin/master` and check whether #595 already has an owner fix; retain behavioral tests but do not overwrite a newer correction.

- [x] Add exact-path regression tests with two files in `cdm.base.datetime`, enum first and type second, both carrying the same namespace artifact key. Include reversed order, explicit file-only navigation, an unresolved declaration, a replacement of the catalogue path by the hydrated owner path, same basenames in two bundles, mismatched version/artifact and hydrated legacy files without keys.

```ts
const enumFile: WorkspaceFile = {
  name: 'base-datetime-enum.rosetta',
  path: '[cdm]/base-datetime-enum.rosetta',
  content: '',
  dirty: false,
  refOnly: true,
  readOnly: true,
  sourceLoaded: false,
  bundleId: 'cdm',
  bundleVersion: 'latest',
  namespace: 'cdm.base.datetime',
  artifactKey: 'cdm/digest/datetime'
};
const typeFile: WorkspaceFile = {
  ...enumFile,
  name: 'base-datetime-type.rosetta',
  path: '[cdm]/base-datetime-type.rosetta'
};
const request: HydratedSourceRequest = {
  bundleId: 'cdm',
  bundleVersion: 'latest',
  namespace: 'cdm.base.datetime',
  path: enumFile.path,
  nodeId: 'cdm.base.datetime.BusinessCenters'
};
expect(
  resolveHydratedSourcePath(request, [enumFile, typeFile], ['cdm.base.datetime'], 'cdm/base-datetime-type.rosetta')
).toBe(typeFile.path);
expect(resolveHydratedSourcePath(request, [enumFile, typeFile], ['cdm.base.datetime'])).toBeUndefined();
expect(
  resolveHydratedSourcePath(
    { ...request, nodeId: undefined, path: typeFile.path },
    [enumFile, typeFile],
    ['cdm.base.datetime']
  )
).toBe(typeFile.path);
```

- [x] Run `pnpm --filter @rune-langium/studio test -- test/store/explore-file-nav-store.test.ts test/pages/EditorPage.test.tsx`; new resolver tests fail before implementation. Extend EditorPage's existing hydration/source reveal fixtures to include multiple namespace files and real per-document ownership. Assert cold BusinessCenters/Counterparty selection activates the type file, pending source navigation cannot activate the first enum file, and `revealLine` acknowledges only the matching ready view. Retain existing rapid A→B, explicit tab navigation, same-path source failure, workspace change and deferred-path replacement tests; add delayed hydration variants of each.
- [x] Implement the pure resolver and replace the namespace-only hydrated-file selection. Capture declaration identity with the existing pending navigation request when it originates from selection; preserve explicit file intent when it originates from a file request. Re-resolve the current declaration's owner after hydration, including canonical dispatch-base ownership for functions. Cancel superseded request identities before switching active files. Do not treat `deferredExports` catalogue ownership as authoritative after resolved models become available, or silently fall back to another namespace file when ownership is missing/ambiguous.
- [x] Extend the curated-source integration fixture from one document to two distinct documents in the same namespace using its existing real parser, serialized artifacts and API handlers. Verify hydrated model/document ownership, lazy source delivery, exact active file content and read-only status together. Add a function far below an enum in its original file. In EditorPage lifecycle tests, delay source until after view creation, delay view until after source, hide/reopen Source and restore cached content; each case reveals the function line using the existing `applyPendingReveal` path. A source download completing is not a reveal acknowledgement, and a namespace artifact key alone is not evidence that offsets belong to the selected document.
- [x] Fix only gaps demonstrated by those reveal tests. Keep the full original file and existing CodeMirror `revealLine` behavior; never replace the source with an extracted function, remove the scroll assertion, widen timeouts to hide misrouting, or introduce a second reveal scheduler. Preserve source-origin cursor position and cancellation on explicit file navigation. Run `pnpm --filter @rune-langium/studio test -- test/store/explore-file-nav-store.test.ts test/pages/EditorPage.test.tsx test/integration/curated-source-editor.test.tsx`, `pnpm --filter @rune-langium/studio run type-check`, `pnpm exec oxlint apps/studio/src/shell/explore-file-nav-store.ts apps/studio/src/shell/ExplorePerspective.tsx` and `pnpm exec oxfmt --check apps/studio/src/shell/explore-file-nav-store.ts apps/studio/src/shell/ExplorePerspective.tsx`.
- [x] Retain J04a/J04b's exact source-file assertions and strengthen J20 to check the visible declaration and its reveal cue, with cold and warm reload paths. Extend J04 with delayed navigation and a same-namespace enum→type switch so file order cannot mask the failure. Preserve J20's existing no-source-refetch and zero-downloaded-curated-document assertions; use canonical anchor declarations already in the corpus rather than inventing production content.

```ts
await expect(page.getByLabel('Source file path')).toContainText('base-datetime-type.rosetta');
await expect(page.locator('[data-pane="source"] .cm-content')).toContainText('type BusinessCenters');
// In J20's existing openSource helper, after requesting Abs:
const declaration = page.locator('[data-pane="source"] .cm-source-reveal-line').filter({ hasText: 'func Abs:' });
await expect(declaration).toBeVisible();
await expect(declaration).toBeInViewport();
```

- [x] Commit `fix: retain curated declaration source identity through hydration`. Record local regression results separately from the original nightly evidence. The existing production journeys run against confirmed-current production after an authorized merge/deployment; until then, #595 remains open and production validation is explicitly pending. A later implementation PR may use `Fixes #595` only when the source selection/reveal fix and required local checks pass; do not close it while merely planning.

## Shared test fixture and interface contract

Task 1 creates `packages/visual-editor/test/helpers/inspector-fixture.ts`. Its exported helper is used verbatim in later snippets:

```ts
import { readFileSync } from 'node:fs';
import { parse } from '@rune-langium/core';
import { createEditorStore } from '../../src/store/editor-store.js';

export async function loadInspectorFixture(
  source = readFileSync(new URL('../fixtures/forms-baseline.rosetta', import.meta.url), 'utf8')
) {
  const parsed = await parse(source);
  if (parsed.hasErrors) throw new Error('Inspector fixture must parse');
  const store = createEditorStore();
  store.getState().loadModels(parsed.value);
  const getNode = (name: string) => {
    const node = store.getState().nodes.find((candidate) => candidate.data.name === name);
    if (!node) throw new Error(`Fixture declaration missing: ${name}`);
    return node;
  };
  return { store, source, getNode };
}
```

Introduce these contracts in Tasks 1–3. Later tasks import them; do not invent alternative property names or retain captured indices as selection:

```ts
// metadata-target.ts; canonical core AST/Dehydrated and DomainNodeData imports.
export type MetadataPath =
  | readonly []
  | readonly ['attributes', number] // Data attributes and Choice options
  | readonly ['inputs', number]
  | readonly ['output']
  | readonly ['enumValues', number];
export type MetadataNode =
  | DomainNodeData
  | Dehydrated<Attribute>
  | Dehydrated<ChoiceOption>
  | Dehydrated<RosettaEnumValue>;
export interface MetadataTarget {
  nodeId: string;
  parseEpoch: number;
  owner: DomainNodeData;
  path: MetadataPath;
  expected: MetadataNode;
}
export interface MetadataCapabilities {
  definition: boolean;
  display: boolean;
  annotations: boolean;
  synonymField?: 'synonyms' | 'enumSynonyms';
  synonymKind?: 'class' | 'body' | 'enumValue';
}
export type MetadataItem =
  | Dehydrated<AnnotationRef>
  | Dehydrated<RosettaClassSynonym>
  | Dehydrated<RosettaSynonym>
  | Dehydrated<RosettaEnumSynonym>;
export type MetadataCommand =
  | { kind: 'definition'; value: string }
  | { kind: 'display'; value: string | undefined }
  | { kind: 'append'; field: 'annotations' | 'synonyms' | 'enumSynonyms'; value: MetadataItem }
  | {
      kind: 'replace';
      field: 'annotations' | 'synonyms' | 'enumSynonyms';
      index: number;
      expected: MetadataItem;
      value: MetadataItem;
    }
  | { kind: 'remove'; field: 'annotations' | 'synonyms' | 'enumSynonyms'; index: number; expected: MetadataItem };
export type MetadataEditResult =
  | { status: 'committed' }
  | { status: 'stale' | 'readOnly' | 'unsupported' }
  | { status: 'invalid'; issues: readonly { path: readonly PropertyKey[]; message: string }[] };
export interface InspectorMetadataActions {
  captureMetadataTarget(nodeId: string, path: MetadataPath): MetadataTarget | undefined;
  applyMetadataCommand(target: MetadataTarget, command: MetadataCommand): MetadataEditResult;
}
```

`MetadataTarget` is a synchronous commit guard, not a selection object or persisted model. `owner`/`expected` are the canonical committed objects, never RHF draft clones. Capture fresh after resolving the current row and before mutation; reject old epoch/object identities. `replace`/`remove` also compare the expected current item so stale chip indices cannot remove a neighbor.

### Task 1: Canonical field lookup and guarded target resolution

**Files:** Create `packages/visual-editor/src/schemas/editor-field-schema.ts`, `packages/visual-editor/src/store/metadata-target.ts`, the fixture helper above, `packages/visual-editor/test/store/metadata-target.test.ts`, `packages/visual-editor/test/forms/editor-field-schema.test.ts`. Modify `packages/visual-editor/src/components/forms/EditorFormProvider.tsx`.

**Interfaces:** Consumes existing `EditorState`, `DomainNodeData`, `SCHEMA_BY_TYPE`. Produces contracts above plus `captureMetadataTarget(state: EditorState, nodeId: string, path: MetadataPath): MetadataTarget | undefined`, `resolveMetadataTarget(state: EditorState, target: MetadataTarget): MetadataNode | undefined`, `getMetadataCapabilities(node: MetadataNode): MetadataCapabilities`, `getEditorFieldSchema(root: z.ZodType, path: string): z.ZodType | undefined`.

- [x] Write target tests using the real store; include stale epoch, replacement owner, reordered/deleted child, same-name replacement and unsupported owner/path pairs.

```ts
it('rejects a child captured before reordering rather than editing its neighbor', async () => {
  const { store, getNode } = await loadInspectorFixture();
  const target = captureMetadataTarget(store.getState(), getNode('Person').id, ['attributes', 0])!;
  expect(resolveMetadataTarget(store.getState(), target)).toBe(target.expected);
  store.getState().reorderAttribute(target.nodeId, 0, 1);
  expect(resolveMetadataTarget(store.getState(), target)).toBeUndefined();
  const fresh = captureMetadataTarget(store.getState(), target.nodeId, ['attributes', 1])!;
  expect(fresh.expected).toMatchObject({ name: 'name' });
});

it('does not retarget a deleted child when its old name is reused', async () => {
  const { store, getNode } = await loadInspectorFixture();
  const id = getNode('Person').id;
  const pending = captureMetadataTarget(store.getState(), id, ['attributes', 0])!;
  store.getState().removeAttribute(id, 'name');
  store.getState().addAttribute(id, 'name', 'string', '0..1');
  expect(resolveMetadataTarget(store.getState(), pending)).toBeUndefined();
});
```

- [x] Write canonical field tests for `attributes.0.name`, `inputs.1.definition`, `enumValues.0.display`, enum metadata, optional arrays, identifier unions and unknown paths. Assert enum display is supported and an invented enum `labels` field is not. Run `pnpm --filter @rune-langium/visual-editor test -- test/store/metadata-target.test.ts test/forms/editor-field-schema.test.ts`; expect missing-module failures before implementation.
- [x] Move the existing `fieldSchema` resolver out of `EditorFormProvider` without changing its constraints or identifier-union handling. Export it as `getEditorFieldSchema`; the provider keeps its existing normalized-index validator cache. Use the same function for metadata capabilities/field validation.
- [x] Implement the path whitelist and guards; `attributes` must match Data/Annotation/Choice, `inputs`/`output` Function, `enumValues` Enumeration. Bounds must be finite nonnegative integers. Resolve live canonical objects before entering the Mutative draft.

```ts
function readAtMetadataPath(owner: DomainNodeData, path: MetadataPath): MetadataNode | undefined {
  if (path.length === 0) return owner;
  if (path[0] === 'output') return path.length === 1 && owner.$type === 'RosettaFunction' ? owner.output : undefined;
  if (path.length !== 2) return undefined;
  const index = path[1];
  if (!Number.isInteger(index) || index < 0) return undefined;
  switch (path[0]) {
    case 'attributes':
      return owner.$type === 'Data' || owner.$type === 'Choice' || owner.$type === 'Annotation'
        ? owner.attributes[index]
        : undefined;
    case 'inputs':
      return owner.$type === 'RosettaFunction' ? owner.inputs[index] : undefined;
    case 'enumValues':
      return owner.$type === 'RosettaEnumeration' ? owner.enumValues[index] : undefined;
  }
}
```

```ts
// Resolve a captured guard; readAtMetadataPath is defined in this module and
// only handles the typed, owner-validated MetadataPath union above.
export function resolveMetadataTarget(state: EditorState, target: MetadataTarget) {
  const owner = state.nodesById.get(target.nodeId)?.data;
  if (state.parseEpoch !== target.parseEpoch || owner !== target.owner) return undefined;
  const current = readAtMetadataPath(owner, target.path);
  return current === target.expected ? current : undefined;
}
```

- [x] Derive supported fields, including optional enum-value `display`, from `SCHEMA_BY_TYPE` through `getEditorFieldSchema`. Select synonym variants by canonical `$type`: Data/Choice class, Attribute/ChoiceOption/Enumeration body, EnumValue enumValue. Unsupported types return no synonym capability. Do not infer supported metadata from loose-object unknown properties.
- [x] Run both new suites and existing form validation tests, then `pnpm --filter @rune-langium/visual-editor run type-check`. Commit owned paths with `refactor: share canonical Inspector target resolution`.

### Task 2: Metadata recipes and additive store actions

**Files:** Create `packages/visual-editor/src/store/metadata-ops.ts`, `packages/visual-editor/test/store/metadata-ops.test.ts`. Modify `packages/visual-editor/src/store/editor-store.ts`, `packages/visual-editor/src/types.ts`, `packages/visual-editor/src/model.ts`; extend `packages/visual-editor/test/store/edit-reconcile.integration.test.ts`.

**Interfaces:** Consumes Task 1 targets/capabilities. Produces `InspectorMetadataActions` on the store and `createAnnotationDraft(name: string, attribute?: string, qualifiers?: readonly Dehydrated<AnnotationQualifier>[]): Dehydrated<AnnotationRef>`, `createSynonymDraft(kind: 'class' | 'body' | 'enumValue', source: string, value?: string): MetadataItem | undefined`. Form props receive optional `metadataActions?: InspectorMetadataActions`; existing CommonFormActions remain usable.

- [x] Add behavior tests for a child definition edit, rich annotation replacement, all synonym variants, negative/stale item indices, read-only owners, invalid payloads and exactly one undo entry per successful command.

```ts
it('commits child metadata through the existing undo and patch path', async () => {
  const { store, getNode } = await loadInspectorFixture();
  const id = getNode('Person').id;
  const target = store.getState().captureMetadataTarget(id, ['attributes', 0])!;
  const before = store.temporal.getState().pastStates.length;
  expect(store.getState().applyMetadataCommand(target, { kind: 'definition', value: 'Full name' })).toEqual({
    status: 'committed'
  });
  expect(store.getState().pendingEditPatches.at(-1)?.path).toEqual([
    'nodes',
    id,
    'data',
    'attributes',
    0,
    'definition'
  ]);
  expect(store.temporal.getState().pastStates.length).toBe(before + 1);
  expect(getNode('Person').data).not.toHaveProperty('definition');
  store.temporal.getState().undo();
  expect(store.getState().captureMetadataTarget(id, ['attributes', 0])?.expected).not.toHaveProperty('definition');
});
```

- [x] Run `pnpm --filter @rune-langium/visual-editor test -- test/store/metadata-ops.test.ts`; expect missing actions before implementation.
- [x] Build drafts through the canonical generated schemas. Populate required `AnnotationRef.qualifiers`, preserve existing `attribute`/qualifiers on updates, and share reference qualification with `resolveSynonymRefText`. Class values are optional; body/enumValue require a nonempty value and source.

```ts
return AnnotationRefSchema.parse({
  $type: 'AnnotationRef',
  annotation: { $refText: name },
  ...(attribute ? { attribute: { $refText: attribute } } : {}),
  qualifiers: qualifiers ?? []
});
```

- [x] Validate only the edited canonical field/item before mutation; unrelated expression drafts must not block valid metadata. Check target and item identity, read-only state and capabilities before entering `mutateGraph`. Return canonical issue messages on invalid input; no history/patch/source change on rejected commands. Mutate a field/array in place through existing generated DomainOps where available, retaining other AST fields and source ranges. The display command sets/clears canonical `display` independently of the value's identifier; test set, clear, undo/redo and rejection on unsupported targets.
- [x] Delegate existing root definition/annotation/synonym and enum-value synonym actions to the same recipes, capturing current root/child at each call. Retain current method signatures and legacy notes behavior. Do not transplant rich-payload construction into JSX.
- [x] Extend reconciliation integration: commit metadata, render/save, begin another metadata edit, load the matching reparse and assert both edits and child ownership survive. Include reorder followed by reparse. Run metadata suites, `mutate-graph` and reconciliation suites plus type-check. Commit `feat: support guarded child metadata mutations`.

### Task 3: Form-local selection and target-safe debounce

**Files:** Create `packages/visual-editor/src/components/forms/metadata/useInspectorSelection.ts`, `MetadataTargetContext.tsx`, `packages/visual-editor/src/hooks/editor-commit-lifecycle.tsx`, `packages/visual-editor/test/forms/inspector-selection.test.tsx`. Modify `packages/visual-editor/src/components/forms/sections/EditorActionsContext.tsx`, `packages/visual-editor/src/components/forms/EditorFormProvider.tsx` and `packages/visual-editor/src/hooks/useAutoSave.ts` additively; extend `packages/visual-editor/test/hooks/useAutoSave.test.ts`.

**Interfaces:** Produces `InspectorRowBinding { key: string; name: string; path?: MetadataPath; inherited: boolean; readonlyNode?: MetadataNode }`, `InspectorSelection { selectedKey?: string; select(key: string): void; clear(): void; resolve(key: string, scopeKey: string): InspectorRowBinding | undefined }`, `useInspectorSelection(scopeKey: string, rows: readonly InspectorRowBinding[]): InspectorSelection`. The target context binds `scopeKey`, optional `formPrefix`, current node/capabilities and `commit(command: MetadataCommand): MetadataEditResult`; root prefix is empty, while inherited bindings have no writable prefix/path. Reuse the parent RHF provider.

`useAutoSave` keeps its callable setter API and gains `flush(): void` as a property on that setter. The existing timer/pending-value state is the only debounce. `EditorCommitRegistry { register(flush: () => void): () => void; flush(): void }` owns callbacks only; `createEditorCommitRegistry()` and its React context live in `editor-commit-lifecycle.tsx`. EditorFormProvider owns one registry and optionally registers its aggregate flush with the host through `registerCommitFlush?: (flush: () => void) => () => void`. Standalone hosts require no new props.

- [x] Write a fixture component using the existing `useZodForm`/EditorFormProvider and real store actions. Type into A's definition, select B before 500ms, then run timers. A changes, B does not. Also rename/reorder A, remove A and reuse its name, change scope, and preserve an invalid attribute-name draft when returning to A. The fixture's selection controls have `Select name`/`Select age` labels; real row tests retain the current `Attribute name: value` labels.

```ts
fireEvent.focus(screen.getByLabelText('Select name'));
fireEvent.change(screen.getByLabelText('Definition'), { target: { value: 'A draft' } });
fireEvent.focus(screen.getByLabelText('Select age'));
await act(async () => vi.advanceTimersByTime(500));
expect(store.getState().captureMetadataTarget(id, ['attributes', 0])?.expected).toMatchObject({
  definition: 'A draft'
});
expect(store.getState().captureMetadataTarget(id, ['attributes', 1])?.expected).not.toHaveProperty('definition');
```

- [x] Run the new selection suite; expect absent selection/context behavior before implementation.
- [x] Key selection by RHF `field.id` and active scope, mapping to current full collection paths. Track committed child names/source ranges during own rename/reorder. On external reset/reparse, restore only a unique current child match; reject duplicate names, removed children and ambiguous matches. Inherited bindings are inspection-only and never resolve a writable local path without an existing override.
- [x] Use the existing debounce with an explicit envelope; resolve the envelope's row, not the latest selected row. Scope is captured on input. Unmount flushes valid pending work against its original target; deleted/stale/read-only work returns rejection. Lower-pane changes must not unregister fields or create another form.

```ts
type PendingMetadata = { scopeKey: string; rowKey: string; command: MetadataCommand };
const save = useAutoSave<PendingMetadata>((pending) => {
  const row = selection.resolve(pending.rowKey, pending.scopeKey);
  if (!row || row.inherited || !row.path) return;
  const target = metadataActions.captureMetadataTarget(nodeId, row.path);
  if (target) metadataActions.applyMetadataCommand(target, pending.command);
}, 500);
```

- [x] Capture the owner scope rather than reading a new workspace's current actions through a late callback. New `scopeKey` invalidates old resolver closures. Root bindings use the same envelope guard, with a root key/path. Validate drafts before enqueueing; retain invalid text/errors in parent form state.
- [x] Add a fake-clock test enqueuing a value, calling the setter's `flush()` before 500ms, then advancing timers/unmounting. The value commits once. Register existing useAutoSave flush callbacks in the declaration's callback registry; they use exactly the same validation/envelopes as timer/unmount commits.

```ts
const registry = createEditorCommitRegistry();
const commit = vi.fn();
registry.register(() => commit('pending value'));
registry.flush();
expect(commit).toHaveBeenCalledExactlyOnceWith('pending value');
```

The registry test covers aggregation; useAutoSave tests pin timer cancellation and no duplicate flush. Flush does not save invalid drafts or create a source/storage writer. The host integration in Task 7 invokes these callbacks before clearing graph ownership.

- [x] Run selection suite, existing `test/hooks/useAutoSave.test.ts` and canonical field tests. Commit `feat: bind Inspector details to stable selected rows`.

### Task 4: Shared documentation, display, annotations and synonym controls

**Files:** Create `packages/visual-editor/src/components/editors/SynonymEditor.tsx`, `packages/visual-editor/test/editors/metadata-target-sections.test.tsx`. Modify `MetadataSection.tsx`, `AnnotationSection.tsx`, `EnumValueRow.tsx`, `components/forms/sections/config.ts`, `EditorSections.tsx`, `packages/visual-editor/z2f.config.ts`; extend existing synonym/enum row tests.

**Interfaces:** Consumes target context, factory/commit APIs and schema paths. `SynonymEditor` consumes an editable `formPrefix` or a canonical `readonlyNode`, `field: 'synonyms' | 'enumSynonyms'`, `kind: 'class' | 'body' | 'enumValue'`, source options, read-only and guarded commit. Existing public section props continue to work as thin bindings. `MetadataSectionProps` gains optional `includeComments?: boolean`; standalone legacy usage retains current behavior, new Inspector bindings explicitly exclude comments.

- [ ] Render the same sections at root and `attributes.0`/`enumValues.0`. Assert edits affect the intended child, canonical validation fires, class/body/member synonym shapes differ correctly, unsupported controls are absent, and read-only rendering cannot commit. Use `AnnotationRef` fixtures with populated attribute and qualifiers and assert unrelated payload fields survive edits.

```ts
expect(createSynonymDraft('class', 'other.FpML', 'Trade')).toMatchObject({
  $type: 'RosettaClassSynonym',
  sources: [{ $refText: 'other.FpML' }],
  value: { name: 'Trade' }
});
expect(createSynonymDraft('enumValue', 'other.FpML', 'Manager')).toMatchObject({
  $type: 'RosettaEnumSynonym',
  synonymValue: 'Manager'
});
expect(createSynonymDraft('body', 'other.FpML', '')).toBeUndefined();
```

- [ ] Run metadata target, existing `MetadataSection-synonyms.test.tsx` and `EnumValueRow.test.tsx`; new nested behavior should fail before refactoring.
- [ ] Replace root-only `definition`/`annotations`/`synonyms` paths with target-prefixed paths and canonical capability checks. Always obtain `$type` from the bound child rather than the parent form's `$type`. Keep EditorController validation and existing picker primitives; disable Add until required inputs are valid. Expose supported annotation attribute/qualifier fields through their canonical nested schemas and existing reference controls, retaining unedited rich payloads.
- [ ] Add the enum Display name control to MetadataSection's shared target-aware rendering, bound to `${formPrefix}.display` through EditorController. Its existing useAutoSave receives the Task 3 target-safe envelope and the display command; normalize a cleared input to `undefined` through the same canonical path. The same component's read-only branch reads `readonlyNode.display`. Do not add an enum `labels` field, a second form, or an enum-specific metadata writer.

```ts
const target = actions.captureMetadataTarget(nodeId, ['enumValues', 0]);
if (!target) throw new Error('Enum value fixture target missing');
expect(actions.applyMetadataCommand(target, { kind: 'display', value: 'Account manager' })).toEqual({
  status: 'committed'
});
expect(actions.captureMetadataTarget(nodeId, ['enumValues', 0])?.expected).toMatchObject({
  name: 'Manager',
  display: 'Account manager'
});
```

- [ ] Key the lower metadata section subtree by bound child/prefix so `useFieldArray` never changes its `name` within an existing hook instance. Keep `shouldUnregister: false` for these fields; re-keying the presentation must retain values and errors in the parent form, including an invalid name or pending metadata draft.
- [ ] For inherited children not present in the local form array, render the same construct's read-only branch from `readonlyNode`. Do not register the ancestor's values under a guessed local prefix, copy them into the parent's editable form, or create another child form. Read-only branches expose no mutations and retain provenance.
- [ ] Extract the synonym interaction from both current implementations into `SynonymEditor`. Factories from Task 2 own AST construction; `SourceRefField` and `resolveSynonymRefText` own source selection/qualification. Scope options come from the current canonical declaration/catalogue, preserving existing reference validation; do not hard-code new target rules in the UI.
- [ ] Remove comments from new Inspector section placement and explicitly hide its editor-only field in generated config. Keep standalone comment props/actions and stored notes; no child notes field. SectionRenderer and generated config continue using the same authoritative section assignments.
- [ ] Move EnumForm's new Inspector synonym presentation into details; standalone EnumValueRow may retain its optional presentation by delegating to the same SynonymEditor. Do not retain duplicated chips, validators or add/remove handlers.
- [ ] Run affected section, row/config validation tests and visual-editor type-check; commit `refactor: share Inspector metadata construct editors`.

### Task 5: Common frame, lower pane and inheritance presentation

**Files:** Create `packages/visual-editor/src/components/editors/inspector/InspectorFrame.tsx`, `InspectorDetailsPane.tsx`, `InspectorInheritanceField.tsx`, `packages/visual-editor/test/editors/inspector-frame.test.tsx`. Modify `packages/visual-editor/src/styles.css`, section config as needed, and component exports.

**Interfaces:** `InspectorSection { id: string; label: string; content: ReactNode; members?: boolean }`; `InspectorFrameProps { header: ReactNode; inheritance?: ReactNode; sections: readonly InspectorSection[]; details?: ReactNode; footer?: ReactNode; onSectionChange?: (id: string) => void }`. `InspectorDetailsPaneProps { targetName?: string; children: ReactNode; onClear?: () => void }`. `InspectorInheritanceField` composes existing TypeReferenceField with `value`, `displayName`, `options`, `onSelect`, `disabled` and navigation props.

- [ ] Test frame with multiple sections and with a single/simple section. Verify one header/footer, useful empty details heading, collapsed default without selection, current target name, and keyboard divider bounds.

```tsx
render(
  <InspectorDetailsPane targetName="name">
    <label>
      Definition
      <textarea />
    </label>
  </InspectorDetailsPane>
);
expect(screen.getByRole('region', { name: 'Details: name' })).toBeVisible();
const divider = screen.getByRole('separator', { name: 'Resize item details' });
fireEvent.keyDown(divider, { key: 'ArrowUp' });
expect(Number(divider.getAttribute('aria-valuenow'))).toBeGreaterThan(Number(divider.getAttribute('aria-valuemin')));
fireEvent.click(screen.getByRole('button', { name: 'Collapse item details' }));
expect(screen.getByRole('button', { name: 'Expand item details' })).toHaveAttribute('aria-expanded', 'false');
```

- [ ] Run `test/editors/inspector-frame.test.tsx`; expect missing component failures.
- [ ] Compose existing TypeHeader, Tabs, ErrorsSection and design-system primitives; do not define another declaration header or parent picker. Frame occupies available flex height, main content and lower details scroll separately, footer stays outside both. Sections decide whether details apply; no empty tabs or nested detail tabs. Use existing Explore/Inspector tokens and spacing.

```tsx
<div className="flex h-full min-h-0 flex-col" data-slot="inspector-frame">
  {header}
  {inheritance}
  <div className="flex min-h-0 flex-1 flex-col" data-slot="inspector-main">
    {activeSection.content}
  </div>
  {activeSection.members ? details : null}
  {footer ? <footer data-slot="inspector-footer">{footer}</footer> : null}
</div>
```

- [ ] Implement divider state in the pane, bounded by actual frame height and minimum main/detail sizes, with pointer capture, cancellation cleanup, `role="separator"`, arrow/Home/End support, touch-action and aria values. Persist no model/draft data; in-memory size is sufficient for this change. Collapse hides only details, not the form or function/condition session.
- [ ] Add row focus/selection presentation through shared wrapper attributes, without stealing input focus or intercepting editor/picker keys. Footer omits unknown host save status and uses real validation status. Inheritance wrapper supplies kind restrictions while retaining existing override/provenance components.
- [ ] Run frame tests, lint/style/type-check; commit `feat: add shared Inspector frame and lower details pane`.

### Task 6: Data, Enum and Choice integration

**Files:** Modify `packages/visual-editor/src/components/editors/DataTypeForm.tsx`, `EnumForm.tsx` (including its `PaginatedEnumValues` function), `ChoiceForm.tsx`, `AttributeRow.tsx`, `EnumValueRow.tsx`, `ChoiceOptionRow.tsx`, `packages/visual-editor/src/components/forms/rows/index.tsx`, `packages/visual-editor/src/components/forms/rows/RowDispatchContext.tsx`; extend `packages/visual-editor/test/editors/DataTypeForm.test.tsx`, `EnumForm.test.tsx`, `ChoiceForm.test.tsx`, `row-renderers.test.tsx` and `packages/visual-editor/test/forms/dataform-roundtrip.test.tsx`.

**Interfaces:** Supply existing providers/field arrays to Tasks 3–5. Add optional row `onSelect?: () => void`, `selected?: boolean`; basic edit callbacks stay compatible. Full collection paths are computed before pagination/filtering. Common form props gain optional metadata actions/scope/status and `registerCommitFlush`; forward the latter to EditorFormProvider. No new required actions.

- [ ] Test selection + metadata on actual forms, inline name/type/cardinality editing, inherited inspection/local override, ChoiceOption schema-supported metadata, and a member on the second enum page. Assert root Doc/Meta controls still target the declaration.

```ts
fireEvent.focus(within(rows[0]).getByRole('textbox', { name: /attribute name/i }));
const details = screen.getByRole('region', { name: /Details: name/ });
fireEvent.change(within(details).getByLabelText('Definition'), { target: { value: 'Field docs' } });
await act(async () => vi.advanceTimersByTime(500));
expect(store.getState().captureMetadataTarget(id, ['attributes', 0])?.expected).toMatchObject({
  definition: 'Field docs'
});
expect(store.getState().captureMetadataTarget(id, [])?.expected).not.toHaveProperty('definition');
```

- [ ] Run changed form/row tests before migration; new detail behaviors should fail. Keep existing basic edit checks as regression coverage.
- [ ] Wrap each form's contents with InspectorFrame **inside its existing EditorFormProvider**. Keep existing useExternalSync and committed-name anchors; never move form ownership into an outer shell. Map field.id to actual current array paths, attach selection/focus callbacks and pass the current child context to the bottom pane. Choice uses `attributes`, not an invented `options` property.
- [ ] In Enum paging, pass full row identity/index through PaginatedEnumValues and the registry; page-relative positions must never become AST positions. Remove editable display-name and synonym controls from Inspector rows, supplying both in details via shared metadata controls. Rows retain value-name editing, reorder/remove and existing override/provenance actions. Standalone EnumValueRow APIs keep their current optional presentation through the same shared control binding. Inherited entries remain read-only until an explicit local override exists.
- [ ] Add EnumForm tests proving Display name is in `Details: Manager`, absent from the row, editable/clearable and retained across rename, reorder, page changes and source reparse. Race a pending display edit against a name edit; the legacy full-value callback must read current display from the shared form rather than overwrite it with its committed prop. Clear display and then rename: `undefined` must not fall back to the old committed display name. Test inherited display inspection and explicit local override separately.

```tsx
const row = screen.getAllByRole('listitem')[0];
fireEvent.focus(within(row).getByRole('textbox', { name: /value name/i }));
const details = screen.getByRole('region', { name: 'Details: Manager' });
expect(within(row).queryByRole('textbox', { name: /display name/i })).not.toBeInTheDocument();
fireEvent.change(within(details).getByLabelText('Display name'), {
  target: { value: 'Account manager' }
});
await act(async () => vi.advanceTimersByTime(500));
expect(store.getState().captureMetadataTarget(id, ['enumValues', 0])?.expected).toMatchObject({
  name: 'Manager',
  display: 'Account manager'
});
```

- [ ] Update `dataform-roundtrip.test.tsx`: seed legacy `fixture.comments` with `store.getState().updateComments(node.id, fixture.comments)` before render, assert the new Inspector comments control is absent, edit definition normally and retain the stored-note/source parity assertions. Do not regenerate the pinned baseline to remove its checks. Retain standalone comments tests where they cover the public API.
- [ ] Run affected form/row/parity tests, configured-section and canonical validation tests. Commit `refactor: compose type Inspectors from shared constructs`.

### Task 7: Function, TypeAlias, read-only surfaces and Studio bindings

**Files:** Modify `packages/visual-editor/src/components/editors/FunctionForm.tsx`, `TypeAliasForm.tsx`, `OtherForm.tsx`, `FunctionInputRow.tsx`, `FunctionOutputField.tsx`, `InheritedMembersSection.tsx`, `packages/visual-editor/src/components/panels/EditorFormPanel.tsx`, `packages/visual-editor/src/types.ts`, `packages/visual-editor/src/components.ts`, `packages/visual-editor/src/hooks/useModelSourceSync.ts`; `apps/studio/src/shell/ExplorePerspective.tsx`, `apps/studio/src/App.tsx`, `apps/studio/src/shell/providers/WorkspaceProvider.tsx`, `apps/studio/src/shell/perspectives/workspace-actions-context.ts`. Extend `packages/visual-editor/test/editors/FunctionForm.test.tsx`, `TypeAliasForm.test.tsx`, `readonly-form.test.tsx`, `EditorFormPanel.test.tsx`; create `apps/studio/test/shell/inspector-metadata.test.tsx` for host scope/guard behavior and extend `apps/studio/test/components/App-workspace-isolation.test.tsx` for transition flushing.

**Interfaces:** Existing Function/Data expression slots retain signatures. EditorFormPanel gains optional `metadataActions`, `scopeKey`, `registerCommitFlush`, and `saveStatus?: 'saving' | 'saved' | 'error'`. Studio passes a scope derived from existing `workspaceId` and App's `workspaceEpochRef` (exposed as ephemeral provider state); do not create another generation counter. Metadata guard must also respect `structuralEditsDisabled` and existing source-read-only state.

Extend `useModelSourceSync` to return `SourceSyncHandle { flush(snapshot: SourceSyncSnapshot): Promise<void> }`, where `SourceSyncSnapshot { nodes: TypeGraphNode[]; edges: TypeGraphEdge[]; parseEpoch: number; patches: Patches; inversePatches: Patches }`. Its observer and explicit flush call one shared publish function, retain the frozen parse baseline and deduplication, and await the existing `onModelChanged` receipt. The host's `registerEditorSaveBarrier(flush: () => Promise<void>): () => void` registers the combined form/source flush; App invokes it before the existing `workspaceAutosave.flush()` in `clearWorkspaceState`.

- [ ] Test function input documentation/annotations with the same AttributeRow/metadata editors, inherited inputs, output metadata at `['output']`, alias-supported sections and read-only Other display. Spy on a supplied expression slot's mount/dispose counts during child selection, collapse and resize; they must not change. Preserve legacy public FunctionInputRow behavior by delegating shared presentation/controls rather than changing its callback semantics.

```tsx
const mount = vi.fn();
const dispose = vi.fn();
function BodySlot() {
  useEffect(() => {
    mount();
    return dispose;
  }, []);
  return <textarea aria-label="Function body" defaultValue="set result: id" />;
}
// Supply BodySlot through FunctionForm's existing renderFunctionBodyEditor prop.
fireEvent.focus(screen.getByLabelText('Select id'));
fireEvent.click(screen.getByRole('button', { name: 'Collapse item details' }));
expect(mount).toHaveBeenCalledTimes(1);
expect(dispose).not.toHaveBeenCalled();
```

- [ ] Run function/read-only/panel integration tests; new selected-input metadata should fail before integration.
- [ ] Replace repeated frame/header/footer/parent-picker composition with Tasks 4–5. Function sections retain continuous implementation, pre/post conditions and existing generated projections; add only supported metadata details. TypeAlias and Other do not gain controls absent from canonical schemas/capabilities. All diagnostics remain reachable.
- [ ] Supply current workspace scope to EditorFormPanel without keying/recreating the entire source session on child selection. Bind metadata actions through existing Studio editor action guards; an old scope rejects pending commits. Add a test switching between two workspaces containing identical namespace/type/field names before debounce fires.

```ts
const currentMetadataScope = useLatestRef(scopeKey);
const metadataActions = useMemo<InspectorMetadataActions>(() => {
  const capturedScope = scopeKey;
  return {
    captureMetadataTarget(nodeId, path) {
      if (currentMetadataScope.current !== capturedScope) return undefined;
      return useEditorStore.getState().captureMetadataTarget(nodeId, path);
    },
    applyMetadataCommand(target, command) {
      if (currentMetadataScope.current !== capturedScope) return { status: 'stale' };
      return useEditorStore.getState().applyMetadataCommand(target, command);
    }
  };
}, [scopeKey]);
```

The host wrapper's scope ref is shared by old and current callbacks. A fresh store capture from an old component must not bypass a workspace boundary. Keep the existing owner-specific structural/source guards alongside this scope check; normal declaration navigation within a workspace may still flush a valid edit to the original declaration.

- [ ] Wire the declaration registry flush and canonical source-sync flush into App's existing transition barrier, before graph clear/epoch invalidation. Expose only ephemeral registration callbacks through WorkspaceProvider; no stored callbacks or serialized editor data. Await source publication, then run the existing storage flush and retain current failure/superseding-transition behavior.

```ts
// App owns the active view callbacks; the collection contains no model data.
const editorSaveBarriers = useRef(new Set<() => Promise<void>>());
const registerEditorSaveBarrier = useCallback((flush: () => Promise<void>) => {
  editorSaveBarriers.current.add(flush);
  return () => {
    editorSaveBarriers.current.delete(flush);
  };
}, []);
const flushEditorSaveBarriers = useCallback(async () => {
  for (const flush of [...editorSaveBarriers.current]) await flush();
}, []);
```

```ts
// Combined callback registered by Explore; commitRegistry is Task 3's registry.
commitRegistry.flush();
const latest = useEditorStore.getState();
await sourceSync.flush({
  nodes: latest.nodes,
  edges: latest.edges,
  parseEpoch: latest.parseEpoch,
  patches: latest.pendingEditPatches,
  inversePatches: latest.pendingInversePatches
});
// App clearWorkspaceState order:
await flushEditorSaveBarriers();
await workspaceAutosave.flush();
```

`flushEditorSaveBarriers(): Promise<void>` iterates the callbacks registered by `registerEditorSaveBarrier`. Explicit source flush must use the hook's exact immutable parsed baseline, never the already-mutated live file map. If a coherent source baseline cannot be obtained, reject the transition and retain the current workspace/error for retry. Test a workspace switch initiated at 100ms after a field edit, before either debounce expires: the old workspace's file must contain the edit before activation. Pagehide may request the same flush but cannot promise asynchronous durability; the browser reload journey separately waits for OPFS evidence.

- [ ] Supply saveStatus only from an existing honest host save receipt/state. If no authoritative receipt is available at this seam, omit save text; the common footer still exposes validation/read-only state. Do not manufacture Saved locally or introduce a timer.
- [ ] Run visual-editor form/panel tests, Studio integration tests, both type-checks and expression regression tests. Commit `refactor: unify callable and read-only Inspector composition`.

### Task 8: Source fidelity and reconciliation through child metadata edits

**Files:** Create `packages/core/src/api/source-comments.ts`, `packages/core/test/api/source-comments.test.ts`, `packages/visual-editor/src/serialize/source-trivia.ts`, `packages/visual-editor/test/serialize/metadata-trivia.test.ts`. Modify `packages/core/src/index.ts`, `packages/visual-editor/src/serialize/cst-reuse-renderer.ts` and `packages/visual-editor/src/hooks/useModelSourceSync.ts` only at the source-trivia seam. Extend `packages/visual-editor/test/serialize/cst-reuse-expression-fidelity.test.ts`, `packages/visual-editor/test/store/edit-reconcile.integration.test.ts`; change `packages/codegen/src/emit/rosetta/rosetta-render-core.ts` and `packages/codegen/test/emit/rosetta/render-annotations-synonyms.test.ts` only if a supported metadata variant fails its current render/parse contract.

**Interfaces:** Core produces `SourceComment { offset: number; end: number; text: string }`, `getSourceComments(source: string): readonly SourceComment[]` from canonical lexer tokens, using `getSharedServices` from `packages/core/src/api/shared-services.ts`. VE produces `SourceTriviaIndex { withOwnedTrivia(node: DehydratedNode, rendered: string, reused: boolean): string }` and `createSourceTriviaIndex(source: string, baselineNodes: readonly DehydratedNode[], comments: readonly SourceComment[]): SourceTriviaIndex` within the current render invocation. No persisted trivia fields or new parser/pretty-printer.

- [ ] Use the existing baseline fixture with a leading child comment, inline trailing comment, internal block comment, CRLF and non-BMP text. Edit a child definition and annotation, rename/reorder it, render, reparse and undo. Assert each comment occurs once, remains with its owner, unrelated function bytes remain exact and both pending metadata edits survive reparse.

```ts
const text = source.replace(
  '  name string (1..1)',
  '  // name owner 🧭\n  name string (1..1) // inline owner\n    /* internal owner */'
);
const fixture = await loadInspectorFixture(text.replaceAll('\n', '\r\n'));
const id = fixture.getNode('Person').id;
const target = fixture.store.getState().captureMetadataTarget(id, ['attributes', 0])!;
fixture.store.getState().applyMetadataCommand(target, { kind: 'definition', value: 'Display name' });
fixture.store.getState().renameAttribute(id, 'name', 'fullName');
fixture.store.getState().reorderAttribute(id, 0, 1);
const state = fixture.store.getState();
const output = buildSourceForNamespaces({
  nodes: state.nodes,
  edges: state.edges,
  originalSourceByNamespace: new Map([['demo.forms', fixture.source]]),
  patches: state.pendingEditPatches,
  inversePatches: state.pendingInversePatches
}).get('demo.forms')!;
expect(output.match(/name owner 🧭/g)).toHaveLength(1);
expect(output.indexOf('// name owner 🧭')).toBeGreaterThan(output.indexOf('age int'));
expect((await parse(output)).hasErrors).toBe(false);
```

- [ ] Run new core/VE source tests and existing CST fidelity tests. Record which assertions already pass; implement only the owning-seam gaps demonstrated by these tests.
- [ ] Extract comments with the existing shared Lexer, without regex-scanning strings or constructing another grammar/parser:

```ts
const result = getSharedServices().RuneDsl.parser.Lexer.tokenize(source);
return result.hidden
  .filter((token) => token.tokenType.name === 'SL_COMMENT' || token.tokenType.name === 'ML_COMMENT')
  .map((token) => ({ offset: token.startOffset, end: token.endOffset! + 1, text: token.image }));
```

- [ ] Build trivia ownership once per baseline render from canonical comment offsets and original child `$cstRange`s. Same-line trailing trivia belongs to the preceding child; contiguous leading trivia at child indentation belongs to the following child. Comments inside a child's range belong to its smallest containing construct; unassociated/blank-separated parent comments stay parent-owned. Use original baseline children recovered through existing inverse-patch machinery, not current array order, to classify before a reorder. UTF-16 offsets index original source directly.
- [ ] Integrate trivia at existing recursive render boundaries. Clean reused slices already contain their internal comments: append/prepend only owned trivia outside the slice. Dirty children retain owned internal comment text around their corresponding child boundaries while canonical rendering supplies semantic text. Track emitted comment ranges within the render so parent/child recursion cannot duplicate them. Leading/trailing trivia moves with its child; removed child-owned trivia is removed with that child, and untouched parent/sibling trivia stays present. Normalize relative indentation using the existing renderer helper, preserving original newline style.

```ts
// In the existing recursive renderer, after deciding whether a child is clean.
const text =
  range && !subtreeDirty ? reuseSlice(originalSource, range, isChild) : renderNode(child, renderChild, { renderExpr });
if (text !== null) return trivia.withOwnedTrivia(child, text, Boolean(range && !subtreeDirty));
```

- [ ] Preserve schema gate and existing CST fallback behavior, with no independent metadata serializer. For a demonstrated unsupported new item variant, implement it in canonical `rosetta-render-core.ts`, add its schema registry entry if needed, test parsed round-trip and rebuild codegen. Never display a successful commit for a new metadata construct silently omitted by rendering.
- [ ] Run core source-comments tests, VE trivia/CST/reconcile tests, codegen annotation/synonym round-trip tests, then core/codegen/VE type-check and required builds. Commit `fix: preserve source trivia through Inspector metadata edits`.

### Task 9: Browser, persistence and accessibility journeys

**Files:** Create `apps/studio/test/e2e/inspector-details.spec.ts`; extend `apps/studio/test/services/workspace-autosave.test.ts`, `apps/studio/test/workspace/workspace-manager.test.ts` and `packages/visual-editor/test/forms/dataform-roundtrip.test.tsx`. Reuse `apps/studio/test/helpers/type-navigation.ts` and hermetic file fixtures; no production harness or deployment changes.

**Interfaces:** Browser fixtures use real `.rosetta` uploads and actual Inspector/store/source behavior. Add stable `data-slot`/accessible labels only for meaningful UI boundaries introduced above, not test-only private state APIs.

- [ ] Add browser checks for selection + inline basics + bottom metadata, enum display-name editing/clearing/reload, rename/reorder/reload, source-only comments, inherited inspection/override, paging, divider keyboard/touch, narrow viewport/text scaling and function/condition session continuity.

```ts
async function waitForSavedSource(page: Page, fileName: string, expected: string) {
  await page.waitForFunction(
    async ({ fileName, expected }) => {
      async function contains(directory: FileSystemDirectoryHandle): Promise<boolean> {
        for await (const [name, handle] of directory.entries()) {
          if (handle.kind === 'file' && name === fileName) {
            const file = await (handle as FileSystemFileHandle).getFile();
            if ((await file.text()).includes(expected)) return true;
          } else if (handle.kind === 'directory' && (await contains(handle as FileSystemDirectoryHandle))) {
            return true;
          }
        }
        return false;
      }
      return contains(await navigator.storage.getDirectory());
    },
    { fileName, expected }
  );
}

test('selected field metadata survives rename and reload', async ({ page }) => {
  await page.goto('./');
  await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
    name: 'details.rosetta',
    mimeType: 'text/plain',
    buffer: Buffer.from('namespace demo.inspector\ntype Person:\n  name string (1..1)\n  age int (0..1)\n')
  });
  await page.getByTestId('namespace-search').fill('Person');
  await typeNavigationButton(page, 'demo.inspector.Person', 'Data').click();
  await page.getByRole('button', { name: 'Inspector', exact: true }).click();
  const row = page.locator('[data-slot="attribute-row"]').first();
  await row.getByRole('textbox', { name: /attribute name/i }).focus();
  const details = page.getByRole('region', { name: 'Details: name' });
  await details.getByLabel('Definition').fill('Full name');
  await row.getByRole('textbox', { name: /attribute name/i }).fill('fullName');
  await expect(page.getByRole('region', { name: 'Details: fullName' })).toBeVisible();
  const sourceToggle = page
    .getByRole('toolbar', { name: 'Center pane selector' })
    .getByRole('button', { name: 'Source', exact: true });
  if ((await sourceToggle.getAttribute('aria-pressed')) !== 'true') await sourceToggle.click();
  await expect(page.getByTestId('source-editor').locator('.cm-content')).toContainText('Full name');
  await waitForSavedSource(page, 'details.rosetta', 'Full name');
  await page.reload();
  await page.getByTestId('namespace-search').fill('Person');
  await typeNavigationButton(page, 'demo.inspector.Person', 'Data').click();
  await page.getByRole('button', { name: 'Inspector', exact: true }).click();
  await page
    .locator('[data-slot="attribute-row"]')
    .first()
    .getByRole('textbox', { name: /attribute name/i })
    .focus();
  await expect(page.getByRole('region', { name: 'Details: fullName' }).getByLabel('Definition')).toHaveValue(
    'Full name'
  );
});
```

- [ ] Start an owned dev server directly with `pnpm --filter @rune-langium/studio exec vite --host 127.0.0.1 --port 5174 --strictPort`; do not run cleanup scripts or reuse the user's primary 5173 server. Run `PLAYWRIGHT_BASE_URL=http://127.0.0.1:5174 pnpm --filter @rune-langium/studio exec playwright test test/e2e/inspector-details.spec.ts --retries=0` using isolated contexts. Failures before completing integration should describe the missing behavior, not a dead server.
- [ ] Strengthen persistence integration using existing fake storage/clock harness: make several valid child edits, assert existing debounce coalesces writes, delay the first save while making a newer edit, transition workspace, and reject/retry storage. The latest snapshot must save before activation; stale child callbacks cannot edit identical IDs in another workspace. Do not modify debounce semantics to make tests pass.
- [ ] Exercise narrow panels with a long annotation/synonym list and at least two enum pages. Run AxeBuilder over the actual Inspector, verify controls stay inside pane bounds and resize observer/console errors are absent. Tests wait for visible readiness and committed source rather than `networkidle` or arbitrary sleeps.
- [ ] Run the new journeys alongside `expression-workspace.spec.ts` and the existing `pnpm --filter @rune-langium/studio run test:z2f-hmr`. Include Task 0's multi-document curated source integration/reveal regressions when verifying the new Inspector frame; inherited/curated details and Open in Source must retain that fixed navigation identity. Network LSP cases remain explicit opt-in and skipped coverage is reported; do not claim hosted production proof from local journeys.
- [ ] Stop only the owned server. Commit `test: cover selected-item Inspector persistence and accessibility`.

### Task 10: Qualitative assessment, documentation and final verification

**Files:** Create `docs/investigations/2026-10-12-inspector-562-assessment.md`. Update `docs/agents/architecture.md`, `docs/agents/workflow.md`, `specs/013-z2f-editor-migration/loc-report.md` and relevant migration task/contract notes, retaining historical evidence. Update #562's stale issue description after implementation evidence exists.

**Interfaces:** Produces the source-backed construct reuse matrix and validation report required by the approved spec; it is the closeout gate, not a LOC score.

- [ ] Populate an assessment row for every shared construct and applicable declaration/child owner:

```markdown
| Construct     | Canonical implementation         | Owners/bindings                       | Behavior evidence                           | Deliberate variant/exception          |
| ------------- | -------------------------------- | ------------------------------------- | ------------------------------------------- | ------------------------------------- |
| Documentation | MetadataSection + target context | Declaration and supported child paths | Nested edits, validation, source round-trip | Schema-unsupported properties omitted |
| Synonyms      | SynonymEditor + metadata-ops     | Class, body and enumValue variants    | Cross-namespace and required-value tests    | AST payload variants remain typed     |
```

- [ ] Inspect remaining repeated UI/semantic logic after all migrations. Add rows for attributes/function inputs, annotations, inheritance, header/footer/navigation and conditions/errors. Name exact implementation files and tests; include standalone wrappers and generated/custom config consumers. Resolve parallel editors/factories rather than counting shared hook imports. Record actual remaining exceptions and their reason; do not invent a passing percentage.
- [ ] Update architecture/workflow guidance for the common frame, form-local selection, guarded target actions, source-only comments and honest save status. Document #595's declaration-owned curated routing and request-scoped reveal, retaining active-namespace source laziness and existing cache semantics. Mark the original LOC criterion explicitly superseded by the user's October 11 qualitative decision; retain measured history. Confirm public callback APIs and stored notes coverage are retained.
- [ ] Run relevant complete visual-editor and Studio test suites, lint/style/format checks, workspace type-check and final browser journeys. If Task 8 changed core/codegen runtime rendering, include full affected package tests and rebuilds before consumer verification. Use these commands from the root:

```bash
pnpm --filter @rune-langium/visual-editor test
pnpm --filter @rune-langium/studio test
pnpm --filter @rune-langium/visual-editor run lint
pnpm --filter @rune-langium/studio run lint
pnpm run type-check
pnpm exec oxfmt --check packages/visual-editor/src apps/studio/src
pnpm --filter @rune-langium/core test
pnpm --filter @rune-langium/codegen test
```

- [ ] Record exact commands/results, public-behavior coverage, source-rich fixture revisions, browser bounds/axe/console evidence and any explicit hosted-LSP gaps. No production deployment or checkout is implied by this plan.
- [ ] Update #562 with the explicit criterion revision and confirmed implementation evidence, retaining separate persistence incidents. Keep it open while the implementation PR awaits review/merge; use `Fixes #562` in the PR only after the complete construct matrix, required checks and final review pass, so closure follows an authorized merge. Commit documentation as `docs: record qualitative Inspector consolidation evidence`.
- [ ] Before final delivery, get one fresh whole-branch review under the selected inline execution method. Address justified findings and rerun only affected checks. Preserve dirty files and Infigraph continuity. A later PR may be created for review; merging/deployment requires its user authorization.

## Spec coverage and planning self-review

| Approved requirement                                    | Owning tasks      |
| ------------------------------------------------------- | ----------------- |
| Shared constructs and semantic variants                 | 1, 2, 4, 6, 7, 10 |
| Shared header/footer/navigation; appropriate tabs       | 5, 6, 7           |
| Bottom child details with inline basic controls         | 3, 5, 6, 7, 9     |
| Enum display names in details, canonical field retained | 1, 2, 4, 6, 9     |
| Same form, canonical L1 and retained drafts             | 1, 3, 4, 6, 7     |
| Child identity, stale callbacks, rename/reorder/reparse | 1, 2, 3, 8, 9     |
| Inherited/curated/unsupported read-only behavior        | 1, 4, 6, 7, 9     |
| Code-only comments and legacy notes preservation        | 4, 6, 8           |
| Canonical source rendering and comment ownership        | 2, 8, 9           |
| Existing undo, persistence debounce and save barriers   | 2, 3, 9           |
| Public standalone callback compatibility                | 2, 4, 6, 7        |
| Expression editor/projection/session preservation       | 5, 7, 9           |
| Qualitative #562 assessment and durable documentation   | 10                |

Expected missing modules/action failures in the test-first steps are future execution expectations, not tests run during planning. Code blocks show the key implementation changes and tests; retain existing fixture teardown/import patterns and use the listed explicit cases with the same public interfaces. No product code is created by writing this document.

Additional scope coverage: #595's exact curated source ownership, cold/warm declaration reveal and navigation cancellation are owned by Tasks 0, 7, 9 and 10.
