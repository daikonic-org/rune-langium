# Inline expression editing in Compose implementation plan

> **For implementation agents** Use Superpowers' executing-plans or subagent-driven-development once the execution approach is agreed. Track each step using its checkbox.

**Goal** — Edit the expressions of ordinary and annotated functions in Compose Source, with the same slots, palette, and variable picker available on Canvas and in Explore data conditions.

**Architecture** — Read structured rows and linked scope from the captured Rune file. Extend the existing builder to render inline and edit exact source spans. Use one Composer draft and the existing CodeMirror source history to apply edits across views.

**Stack** — Langium, the Studio parser worker, React, Base UI, Dockview, CodeMirror 6, Vitest, and Playwright.

**Spec** — [Inline expression editing in Compose](../specs/2026-11-20-compose-inline-expressions-design.md) and the [existing expression editing contract](../specs/2026-10-08-expression-editing-design.md).

## Global constraints

- Node `^22.22.2 || ^24.15.0 || >=26.0.0` and `pnpm@11.5.0`. Use the current grammar, adapters, parser, worker queue, and workspace save path. New package source is MIT and new Studio source is FSL-1.1-ALv2.
- Rune source and its workspace file identity are authoritative. Keep source outside an explicit edit byte-for-byte, including CRLF, comments, definitions, and adjacent declarations. Preserve existing source and projection entry points.
- Visual-editor owns presentation and typed host callbacks. Studio owns CodeMirror, linking requests, revisions, and persistence. Core owns Rune scope and source coordinates.
- One active draft per function. Preserve it on view changes and failed Apply. Keep existing linked candidate validation for Canvas edits and syntax and revision checks for Source-only edits. Browse read-only source and keep write controls unavailable.
- Use the selected Studio theme and existing tokens. Code Book at weight `350` and `94%` width applies to the shared `--font-code` role. Preserve the `--font-title`, `--font-body`, and `--font-mono` stacks.

## Review focus

- A CRLF file with a non-BMP character before the target and another file in the same namespace. Only the captured occurrence changes. **Task 1**
- A delayed picker response after dependency refresh, or after a different slot becomes active. Stale choices cannot bind to the new target. **Task 2**
- Shadowed closure variables and list-valued paths offered to scalar parameters. Keep declaration identity through navigation and allow browsing the list without applying it to a scalar slot. **Task 2**
- Mixed precedence and an unsupported or commented subtree. An edit to a neighboring operand preserves its grouping and exact Rune. **Task 3**
- A step draft survives switching views and a concurrent source change. One successful Apply can be undone once from either Compose view. **Task 4**

## Task 1 — Map statements and guard exact source edits

**Files** — Modify `packages/core/src/utils/source-regions.ts`, `packages/core/src/api/function-composition.ts`, `packages/core/src/index.ts`, `apps/studio/src/services/{expression-document,composition-edit}.ts`, and `apps/studio/src/components/editing/ExpressionWorkspace.tsx`. Extend `packages/core/test/utils/source-regions.test.ts` and `apps/studio/test/services/{expression-document,composition-edit}.test.ts`.

**Interfaces** — Add `ExpressionRow = ExpressionRegion & { statement: SourceRegion }` and `getExpressionRows(owner: Parameters<typeof getExpressionRegions>[0]): readonly ExpressionRow[]`. `ExpressionAddress` contains `root: SourceRegion`, `path: string` (Langium AST locator path relative to that root), and `range: SourceRegion` in original file UTF-16 offsets. Add `getFunctionAliasInsertion(func: RosettaFunction | Dehydrated<RosettaFunction>, source: string): SourceRegion` and `buildAliasEdit(binding: DocumentBinding, insertion: SourceRegion, name: string, expression: string): DocumentEdit`. Add `applyExpressionDocumentEdit(documents: ExpressionDocument, view: EditorView, edit: DocumentEdit): CommitResult`.

- [ ] Add `maps expression rows in grammar order` and `applies an edit only to its captured CRLF occurrence`. Use two files in one namespace and an emoji before the nested assignment. Test zero-width insertion before the first condition, operation, or postcondition and at a signature-only body's end.

  ```ts
  expect(rows.map((row) => row.kind)).toEqual(['alias', 'precondition', 'operation', 'operation', 'postcondition']);
  expect(source.slice(row.region.from, row.region.to)).toBe('value + 1');
  expect(neighborFile.content).toBe(originalNeighborContent);
  ```

- [ ] Run `pnpm --filter @rune-langium/core test test/utils/source-regions.test.ts` and `pnpm --filter @rune-langium/studio test test/services/expression-document.test.ts test/services/composition-edit.test.ts`. Check that the new statement, insertion, and commit tests fail on current behavior.
- [ ] Derive root rows and statement bounds from the same CST and dehydrated traversal as `getExpressionRegions`. Use `getFunctionAliasInsertion` for Compose facts and ordinary Source. Have `compositionAliasEdit` delegate formatting to `buildAliasEdit` while keeping its Canvas eligibility check. Place the new alias before any leading comments attached to the following statement. Use the file's existing newline and indent.
- [ ] Extract the Inspector's CodeMirror Apply path. `applyExpressionDocumentEdit` checks the view against the capture, prepares a single isolated history transaction, and verifies the protected-region filter accepts the intended document. Publish through `ExpressionDocument.applyDocumentEdit` and the existing Source change listener. Assert that a refused transaction, read-only file, and stale capture produce zero workspace writes.
- [ ] Re-run the three suites. Commit `refactor(studio): share guarded expression source edits`.

## Task 2 — Resolve linked candidates and member paths

**Files** — Modify `packages/core/src/utils/expression-scope.ts`, `packages/core/src/index.ts`, `packages/core/src/services/rune-dsl-scope-provider.ts` as needed to expose its existing linked inference, `apps/studio/src/workers/parser-worker.ts`, `apps/studio/src/services/workspace.ts`, and `packages/visual-editor/src/adapters/expression-scope.ts`. Extend `packages/core/test/utils/expression-scope.test.ts`, `apps/studio/test/workers/expression-scope.test.ts`, and `apps/studio/test/services/expression-scope-service.test.ts`.

**Interfaces** — Add `ExpressionPickerTarget = ExpressionAddress | { draftAlias: true } | { draftCondition: 'precondition' | 'postcondition' }`. `ExpressionPickerRequest` carries `target: ExpressionPickerTarget`, `trail: readonly string[]` of linked declaration IDs, and optional `candidateSource: string`. Add `requestExpressionPickerContext(uri: string, nodeId: string, request: ExpressionPickerRequest, files: readonly WorkspaceFile[]): Promise<ExpressionPickerContext>`. Context provides `entries: ExpressionScopeEntry[]` and `members: ExpressionMemberChoice[]`. Each choice has `declarationId`, `name`, `expressionText`, optional `typeName` and `cardinality`, `canBrowse`, and `compatibility: 'compatible' | 'incompatible' | 'unknown'`.

- [ ] Add `resolves a filter's nested scope and shadowed parameters` and `browses a collection path for a scalar argument`. Cover parameterless filter item members, inherited attributes, and malformed addresses or trails. Give the fixture `quotes` a `(1..*)` cardinality and `maturityDate` a `(1..1)` cardinality.

  ```ts
  expect(innerPeriod.declarationId).toBe(closureParameterId);
  expect(asOf).toMatchObject({ expressionText: 'market -> asOf', cardinality: '(1..1)', compatibility: 'compatible' });
  expect(maturityDate).toMatchObject({
    expressionText: 'market -> quotes -> maturityDate',
    cardinality: '(1..*)',
    compatibility: 'incompatible'
  });
  ```

- [ ] Run `pnpm --filter @rune-langium/core test test/utils/expression-scope.test.ts` and `pnpm --filter @rune-langium/studio test test/workers/expression-scope.test.ts test/services/expression-scope-service.test.ts`. Expect missing picker facts at the new sites.
- [ ] Extend the existing queued `expressionScope` request and return context in `ExpressionScopeResponse.picker`. Resolve the captured root and descendant through the AST locator, verify its range and owner, and call the canonical scope provider. Use the containing call as the scope anchor for a new argument hole. Preserve declaration order, add scoped locals to the existing entry and adapter types, and reuse the condition probe and an append-at-end alias probe for new drafts. Use the existing private parse/link/restore sequence for a valid draft whose subtree shape has changed.
- [ ] Resolve each trail segment through the linked feature-call scope. Compute effective path cardinality from linked features and use the same bounds check as Compose argument suggestions. When type inference cannot prove a match, return `unknown` for canonical Apply validation. Read scope on picker demand and reuse identical in-flight requests. Require the current workspace generation, file revision, dependency snapshot, and active slot to match before presenting results.
- [ ] Re-run the suites and `pnpm --filter @rune-langium/core test test/api/function-composition.test.ts`. Assert a late result and a private candidate leave the published workspace unchanged. Commit `feat(studio): resolve expression slots and linked member paths`.

## Task 3 — Add inline presentation to the existing builder

**Files** — Modify `packages/visual-editor/src/components/editors/expression-builder/{ExpressionBuilder,BlockRenderer,ReferencePicker}.tsx` and the affected existing blocks there. Reuse `packages/visual-editor/src/hooks/{useExpressionBuilder,useKeyboardNavigation}.ts` and `packages/visual-editor/src/adapters/{expression-starters,ast-to-expression-node,expression-node-to-dsl}.ts`. Extend `packages/visual-editor/test/expression-builder/{expression-builder,reference-picker,build-flow,use-keyboard-navigation}.test.tsx` and `packages/visual-editor/test/conformance/expression-roundtrip.test.ts`.

**Interfaces** — Add `presentation?: 'inline'` and `sourceTarget?: ExpressionPickerTarget` to `ExpressionBuilderProps`, plus `onActiveSlot?(slot: ExpressionSlot | undefined): void` and `loadPicker?(target: ExpressionPickerTarget, trail: readonly string[]): Promise<ExpressionPickerContext>`. `ExpressionSlot` has a builder `nodeId: string` and the `target: ExpressionPickerTarget`. Keep `renderTextEditor` as the explicit Rune fallback. Expose `onHighlightRange?(range: SourceRegion | undefined): void` for the host's Rune range decoration.

- [ ] Add `fills a named argument placeholder in place` and `changes one primitive without rewriting its operands`. Use all five `InterpolateLinear` inputs. Verify the empty `x` is italic, then choose `upperX` and assert the slot's accessible name still identifies `x`. Swap `<` to `<=` without changing either operand.

  ```ts
  expect(slot).toHaveTextContent(/^upperX$/);
  expect(slot).toHaveAccessibleName(/x argument.*upperX/);
  expect(branchDraft).toBe('if current exists then 0 else amount');
  expect(filterDraft).toBe('periods filter [startDate < asOf] then last');
  ```

- [ ] Run `pnpm --filter @rune-langium/visual-editor test test/expression-builder test/conformance/expression-roundtrip.test.ts`. Expect the new inline controls and exact-byte fixtures to fail.
- [ ] Implement the inline presentation on the current builder tree. Render expanded, collapsible argument groups and flat associative chains. Use outlines and progressively clearer fills at precedence or scope boundaries. Use `PickerTrigger indicator={false}` and the shared popover for contextual symbols, literals, functions, and primitives. A complex value opens its linked members and can be chosen directly when compatible. Keep Back, breadcrumbs, and search above scrollable choices. Enter or Space opens the slot, Escape restores focus, arrows move between chips, and typing edits a value on its existing row.
- [ ] Use the existing operator catalog and starters for comparison, boolean, presence, branches, fallback, and collection operations including `filter`, `extract`, `then`, `sort`, `distinct`, `flatten`, `only-element`, `first`, `last`, `reduce`, `count`, and `sum`. Offer wrap and operator changes when existing children map to their operands or new required holes are explicit. Preserve AST associativity. On an edit, splice the selected range using the existing Rune serializer for the changed part. Preserve exact text in unsupported and unchanged subtrees. An explicit **Edit Rune** mounts the text editor at that span.
- [ ] Re-run the visual-editor and round-trip suites. Test a group with mixed `and`/`or` around a commented or unsupported subtree and assert untouched bytes and semantics. Commit `feat(visual-editor): add inline expression slots and editing`.

## Task 4 — Share the Compose draft, palette, and undo

**Files** — Modify `apps/studio/src/components/compose/{FunctionComposer,CompositionNode,FunctionPalette,ComposeWorkbench}.tsx`, `apps/studio/src/components/compose/function-composer.css`, `apps/studio/src/components/editing/{ExpressionWorkspace,RuneRegionEditor}.tsx`, `apps/studio/src/components/SourceEditor.tsx`, `apps/studio/src/shell/ExplorePerspective.tsx`, and `apps/studio/src/store/compose-navigation-store.ts`. Create `apps/studio/src/components/editing/InlineExpressionRows.tsx`. Extend `apps/studio/test/components/ExpressionWorkspace.test.tsx` and `apps/studio/test/e2e/workflow-function-builder.spec.ts`.

**Interfaces** — Add `requestSource(workspaceKey: string, nodeId: string, target?: ExpressionAddress): void` to the Compose navigation store. The Composer's existing per-function draft map holds a Canvas step draft or a Source row draft, keyed by workspace generation, URI, and owner. `InlineExpressionRows` takes `binding: DocumentBinding`, `rows: readonly ExpressionRow[]`, `draft?: { target: ExpressionPickerTarget; text: string }`, `onSelect(row: ExpressionRow): void`, `onChange(text: string): void`, and Task 3's picker and highlight callbacks. The host owns Apply, Discard, and Add.

- [ ] Add `edits ordinary function expressions and inserts an alias` and `shares an argument draft and undo across Compose views`. Seed the ordinary fixture's `leg` alias with `fallbackPayout` and the annotated fixture's call with a date input `overrideDate`. Change them to `note -> payout` and `market -> asOf`, respectively. Edit the period filter and insert an alias before the first condition or assignment. Switch views during the argument edit and undo through the other view. Check the second file stays byte-identical, and stale, syntax-invalid, and linked-invalid drafts stay available.

  ```ts
  expect(sourceAfterApply).toContain('AccrueNoteInterest(note, market -> asOf)');
  expect(publishedChanges).toHaveLength(1);
  expect(sourceAfterUndo).toBe(originalSource);
  ```

- [ ] Run `pnpm --filter @rune-langium/studio test test/components/ExpressionWorkspace.test.tsx` and the managed `test/e2e/workflow-function-builder.spec.ts`. Expect the inline entry, shared picker, and undo assertions to fail.
- [ ] Make **Open in Compose** in Inspector and Source carry the captured target when the caret identifies one, and open Source with rows expanded for existing functions. Show the original Rune around each expression and keep its statement as its label. Replace the function Builder dialog entry and Compose's leaf expression dialog with the inline presentation. Keep the full-file, TypeScript, and Python actions. Highlight the exact corresponding ranges in both directions when the Rune view is visible. Start Source editing for any uniquely resolved base function regardless of Canvas eligibility. Open a dispatch variant at its concrete full-file declaration.
- [ ] Match Source rows to supported Canvas steps by captured region, and use the current step draft and preview for those rows. Keep Source-only rows in the same draft map. Reuse `FunctionPalette`, `COMPOSITION_PRIMITIVES`, and the new picker in the step argument control and active palette target. A compatible member path writes its authored Rune into the current draft, and a direct variable retains its existing wire ID. Use existing candidate build, validation, and ordering for Canvas changes. Use Task 1's insertion path for **+ Expression**. Require Apply or Discard before switching a dirty target.
- [ ] Keep `ExpressionWorkspace`'s owning Rune region view mounted in the Composer across `SplitWorkbench` visibility changes, and keep it inert when hidden. Route both Apply paths through Task 1's transaction and use its CodeMirror history for Undo in either view. Preserve one LSP publishing owner per URI, with independent buffers for explicit Rune drafts. Honor `ComposeWorkbench`'s desktop palette default, saved dimensions, and compact toggle. Verify Source-only drafts survive a round trip through Canvas, failed validation retains draft, and view changes leave authored bytes and Dockview layout intact.
- [ ] Re-run targeted Studio tests and the existing Compose journey. Add linked starter coverage using the spec's pinned examples and a self-contained fixture for the regular browser gate. Commit `feat(studio): share inline expression editing across Compose views`.

## Task 5 — Reuse inline rows for Explore data conditions

**Files** — Modify `apps/studio/src/shell/ExplorePerspective.tsx`, `apps/studio/src/components/editing/{InlineExpressionRows,DraftConditionEditor,ExpressionWorkspace}.tsx`, and `packages/visual-editor/src/components/editors/ConditionSection.tsx`. Extend `apps/studio/test/e2e/{inspector-condition-drafts,expression-workspace}.spec.ts`, `apps/studio/test/components/ExpressionWorkspace.test.tsx`, and `packages/visual-editor/test/editors/ConditionSection.test.tsx`.

**Interfaces** — Reuse `InlineExpressionRows` and `ExpressionPickerTarget`. Extract `AddConditionForm` for reuse with its existing `onAdd`, `onCancel`, `nodeId`, and `renderExpressionEditor` contract, keeping the existing condition creation action.

- [ ] Test two independently editable conditions on a Data declaration, including the five-argument `InterpolateLinear` case in `inspector-condition-drafts.spec.ts`. Assert adding a condition uses inherited scope and preserves adjacent declarations. Assert reordering or deleting the captured condition prevents applying the old draft to another row. A reference condition is browsable and has no Apply control.

  ```ts
  expect(conditionCountAfterAdd).toBe(originalConditionCount + 1);
  expect(nextDeclarationSource).toBe(originalNextDeclarationSource);
  await expect(referenceRows.getByRole('button', { name: 'Apply', exact: true })).toHaveCount(0);
  ```

- [ ] Run `pnpm --filter @rune-langium/visual-editor test test/editors/ConditionSection.test.tsx`, `pnpm --filter @rune-langium/studio test test/components/ExpressionWorkspace.test.tsx`, and the two managed browser specs. Expect Explore Source to lack the inline condition rows.
- [ ] Mount the shared rows for a selected Data declaration in Explore Source and reuse the existing Add form with the inline `DraftConditionEditor`. Route condition Apply through the captured source transaction, preserve the concrete owner during navigation, and keep explicit full-file Rune opening available. Keep existing metadata editing and language projections attached to the same condition identity.
- [ ] Re-run the component tests and both browser specs. Verify keyboard and touch at `390px`, no horizontal overflow, and exactly one condition added. Commit `feat(studio): edit data conditions inline in Explore Source`.

## Task 6 — Apply the reviewed Code width through the theme

**Files** — Modify `packages/design-system/src/{fonts,tokens}.css` and `packages/design-system/src/fonts/{manifest.json,README.md}`. Package the upright and italic Narrow faces under `packages/design-system/src/fonts/`. Extend the typography check in `apps/studio/test/e2e/control-spacing.spec.ts`.

- [ ] Verify the [2026.11.19.3 Code width trial](https://github.com/daikonic-org/transit-typeface/releases/tag/Transit-2026.11.19.3) against its published archive checksum `80a97e59f49c788ed370686bb28a24f20c03e106c0ac3a29c5c66ad14349d968`. Use its two Code `1.041` faces and pin `wdth=94` with FontTools `4.68.0`, keeping `wght=350..500` and preserving license and notices. Record original artifact, derivation, and the new WOFF2 checksums in the manifest.
- [ ] Add `loads Transit Code Book Narrow for Source and inline editing`. Measure ten monospace cells at `50px` and check upright and italic widths. Assert the `>=` ligature spans one cell, UI and headings resolve to System and Sans, and general mono remains JetBrains. Run `test/e2e/control-spacing.spec.ts` and confirm the Narrow checks fail with the original assets.

  ```ts
  expect(uprightAdvance).toBeCloseTo((10 * 50 * 564) / 1043, 1);
  expect(italicAdvance).toBeCloseTo(uprightAdvance, 1);
  ```

- [ ] Switch both Code faces through the existing `--font-code` token. Keep contextual ligatures, hairlining and texture healing in the built CodeMirror views and inline chips. Re-run the typography test against built assets and verify both WOFF2 files load. Commit `style(studio): use Transit Code Book Narrow`.

## Delivery checks

- [ ] Use the isolated implementation checkout. Validate the current source and install with the pinned toolchain. In a fresh worktree, build `@rune-langium/worker-core` and the affected workspace dependencies before type checks. Preserve the existing mockup preview sessions.
- [ ] Run `pnpm run lint`, `pnpm test`, `pnpm run format:check`, `pnpm run type-check`, and `pnpm run build:studio`. Run the referenced Playwright specs with `pnpm --filter @rune-langium/studio exec playwright test --retries=0` and their paths. Use a free `STUDIO_DEV_PORT` with the managed server and no inherited base URL. Run `pnpm --filter @rune-langium/studio run test:ux-candidate` against the built checkout. Verify all annotated, ordinary, reference, and condition flows at desktop and phone widths, and include byte-identical source and undo assertions.
- [ ] Update `docs/agents/architecture.md` and `docs/agents/workflow.md` with the shared source transaction and verification seams as part of the implementation. Record commands and results for the reviewed commit.

## Canvas eligibility

Enable Canvas editing for linked functions whose bodies pass the existing graph shape checks. Preserve the guards for dispatch, inheritance, whole-output assignment, dependencies and linked validity, including candidate validation on Apply. Keep `[composition]` as a palette discovery signal. Verify ordinary and annotated functions through the same Canvas editing path, and leave bodies outside the supported graph shape in Source.
