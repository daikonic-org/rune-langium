---

> October 11, 2026: the user superseded T070/SC-001's LOC threshold with the qualitative shared-construct gate for [#562](https://github.com/pradeepmouli/rune-langium/issues/562). Historical checklist items below are preserved, not retroactively marked complete. Current execution and public API/persistence/source evidence live in the [Inspector plan](../../docs/superpowers/plans/2026-10-12-inspector-shared-constructs.md) and [assessment](../../docs/investigations/2026-10-12-inspector-562-assessment.md).

description: "Task breakdown for Migrate Visual Editor Forms to zod-to-form"
---

# Tasks: Migrate Visual Editor Forms to zod-to-form

**Input**: Design documents from `/specs/013-z2f-editor-migration/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (form-host-integration, section-component, row-renderer), quickstart.md

**Tests**: TDD is mandated by Constitution Principle V. Each migrated form/component requires failing tests (visual snapshot or component test) before refactor. Existing tests in `packages/visual-editor/test/` MUST continue to pass.

**Organization**: Tasks are grouped by user story (US1–US7) to enable independent implementation, testing, and slice-shipping. Each user story can land as its own pull request.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3) — only on Phases 3–9, never on Setup/Foundational/Polish
- Exact file paths included in descriptions; absolute repo-relative paths under `packages/visual-editor/src/` for source

## Path Conventions

This is a TypeScript pnpm-workspaces monorepo (`rune-langium`). Paths are relative to the repo root `/Users/pmouli/GitHub.nosync/active/ts/rune-langium/`:

- Visual editor source: `packages/visual-editor/src/`
- Visual editor typed config: `packages/visual-editor/z2f.config.ts`
- Visual editor tests: `packages/visual-editor/test/`
- Studio app (Playwright + dev server): `apps/studio/`
- Upstream library reference: `/Users/pmouli/GitHub.nosync/active/ts/zod-to-form/specs/010-editor-primitives/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: The branch `013-z2f-editor-migration` is already checked out and the workspace is wired. This phase confirms the green baseline before any migration work begins. No new tooling is introduced.

- [x] T001 Confirm green baseline: from repo root run `pnpm install`, `pnpm --filter @rune-langium/visual-editor build`, `pnpm --filter @rune-langium/visual-editor test`, and `pnpm run type-check`. Assert all pass before any task in Phase 2 begins.
- [x] T002 Confirm Playwright is wired in `apps/studio/playwright.config.ts` and that `pnpm --filter @rune-langium/studio playwright test --list` enumerates the existing suite (no new tests yet — wiring check only).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Capture the pre-migration baseline (the regression oracle for FR-012 and SC-004) and align the typed config to point at the canonical form-surface schemas (R1). These tasks MUST land before any user-story phase begins because (a) every later slice asserts against the captured baseline, and (b) without R1 alignment, US1's `<ZodForm>` would still resolve to AST schemas.

**⚠️ CRITICAL**: No US1–US7 implementation can begin until this phase is complete. The visual-regression baselines (T003–T005) and the auto-save timing baseline (T006) are the regression oracles for SC-004 and SC-007. The schema-source unification (T007–T009) is the FR-008 / SC-006 prerequisite.

### Pre-migration baseline capture

- [ ] T003 [P] Add Playwright visual-regression spec at `apps/studio/test/visual/forms.spec.ts` covering all five top-level forms — Data, Choice, Enum, Function, TypeAlias — by navigating to a representative node of each kind in the CDM fixture model and taking a full-form screenshot. The spec MUST run `--update-snapshots` cleanly the first time.
- [ ] T004 [P] Add Playwright fixture model loader at `apps/studio/test/visual/fixtures.ts` that opens the CDM corpus from `fixtures/` (or the smallest test model containing one Data, one Choice, one Enum, one Function, one TypeAlias node), exposes a `selectNode(kind)` helper for `forms.spec.ts`, and is reusable by later perf tests.
- [ ] T005 Run `pnpm --filter @rune-langium/studio playwright test apps/studio/test/visual/forms.spec.ts --update-snapshots` and commit the resulting baseline screenshots under `apps/studio/test/visual/__screenshots__/forms.spec.ts/` (filenames `data-baseline.png`, `choice-baseline.png`, `enum-baseline.png`, `function-baseline.png`, `type-alias-baseline.png`). These are the SC-004 reference images for the entire migration.
- [ ] T006 Add Playwright perf spec at `apps/studio/test/perf/auto-save.spec.ts` that, for each of the five forms, types into one representative leaf field, measures `(time of action call) − (time of input event)` over 10 runs, computes the median, and writes the per-form baselines to `apps/studio/test/perf/auto-save-baseline.json`. This is the SC-007 ±50 ms reference.

### Schema source unification (R1 / FR-008 / Phase A)

- [x] T007 Confirm `packages/visual-editor/z2f.config.ts` already imports from `src/generated/zod-schemas.js` and that every AST-only field (`$type` family, `references`, `labels`, `ruleReferences`, `enumSynonyms`, `postConditions`, `arguments`) is marked `hidden: true`. Document any AST field NOT covered by `hidden:` rules; add it.
- [x] T008 Confirm the typed config docstring states the L1/L2 contract: hidden fields are stripped from the schema-lite validation surface at runtime; the AST schemas remain canonical and grammar-driven. No code changes if the previous config already satisfies this — verify and update only the docstring if so.
- [x] T009 Run `pnpm --filter @rune-langium/visual-editor type-check` and confirm zero TypeScript errors. Run the full `pnpm --filter @rune-langium/visual-editor test` and confirm no regressions. Note: editor files under `src/components/editors/` MAY still import projection schemas at this stage (those imports go away in Phase 9 / T076).

**Checkpoint**: Baseline captured, typed config points at the canonical form-surface schemas. US1–US7 implementation can now begin per the dependency graph below.

---

## Phase 3: User Story 1 — Editing a Data type with z2f-rendered fields (Priority: P1) 🎯 MVP

**Goal**: Migrate `DataTypeForm.tsx` from a hand-rolled `<Controller>` cascade to a `<ZodForm>` + bespoke-overrides composition. The Data form is the canonical 471-LOC editor and the template all of Phase 5 (US3) copies. Adopt the upstream `useExternalSync` hook, delete `ExternalDataSync.tsx`, delete `MapFormRegistry.ts`, and adopt `z.registry<FormMeta>()`.

**Independent Test**: Open a model with a Data type, click the node, and confirm the form renders identically to the pre-migration baseline (Playwright visual diff within tolerance). Edit each leaf field (name, parent, definition, comments) and confirm auto-save fires with the same debounce timing (within ±50 ms of T006 baseline). Trigger a validation error (empty name) and confirm the error renders in the same position with the same wording. Switch to a different Data node and confirm the form repopulates without manual reset wiring.

**Upstream dependency**: zod-to-form spec 010, task T021 (`useExternalSync` implementation in `packages/react/src/useExternalSync.ts`) MUST be merged before T013 begins. Verify by running `node -e "console.log(require.resolve('@zod-to-form/react'))"` and checking the resolved file exports `useExternalSync`.

### Tests for User Story 1 (TDD — write first; MUST fail before T013)

- [ ] T010 [P] [US1] Add component test at `packages/visual-editor/test/editors/DataTypeForm.test.tsx`: "renders all leaf fields (name, parentName, definition, comments) with the same labels and tab order as the baseline" — mount with a fixture Data node, query each label by text, assert the input ordering matches `apps/studio/test/visual/__screenshots__/forms.spec.ts/data-baseline.png` reference (use `getAllByRole('textbox')` order).
- [ ] T011 [P] [US1] Add component test at `packages/visual-editor/test/editors/DataTypeForm.test.tsx`: "fires actions.renameType once after debounce on name edit" — mount, type into name field, advance fake timers by 500 ms, assert `actions.renameType` spy called exactly once with `(nodeId, oldName, newName)`.
- [ ] T012 [P] [US1] Add component test at `packages/visual-editor/test/editors/DataTypeForm.test.tsx`: "repopulates form values when `data` reference changes (external sync)" — mount with `data: nodeA`, edit name to dirty the field, swap to `data: nodeB`, assert form re-populates with `nodeB`'s values and the dirty edit on `nodeA` was flushed (action fired against `nodeA.id`). This test asserts the `useExternalSync` integration contract from form-host-integration §2.

### Implementation for User Story 1

- [ ] T013 [US1] Refactor `packages/visual-editor/src/components/editors/DataTypeForm.tsx` to use `<ZodForm>` from `@zod-to-form/react` driving the `dataTypeFormSchema`. Keep `toFormValues(data)` projection as-is (data-model §2). Replace the per-field `<Controller>` cascade for name/parentName/definition/comments with the form host's default rendering. Preserve the bespoke `<TypeSelector>`, `<TypeLink>`, `<TypeCreator>`, `<CardinalityPicker>` registrations (they continue to be looked up via `componentModule`). Preserve the existing `useAutoSave(commitFn, 500)` per-field wiring (R8); do NOT introduce a top-level debouncer.
- [ ] T014 [US1] Replace the local `<ExternalDataSync data={data}>…</ExternalDataSync>` child with a top-of-body `useExternalSync(form, data, toFormValues)` hook call in `DataTypeForm.tsx`. Confirm the hook fires `form.reset(toFormValues(data), { keepDirtyValues: true })` on `data` reference change and is a no-op on identity-stable rerenders.
- [ ] T015 [US1] Delete `packages/visual-editor/src/components/forms/ExternalDataSync.tsx` (65 LOC). Search the package for any remaining imports of the removed file and remove them.
- [ ] T016 [US1] Delete `packages/visual-editor/src/components/forms/MapFormRegistry.ts`. Migrate any consumers to `z.registry<FormMeta>()` from `@zod-to-form/core`. Update `packages/visual-editor/src/components/zod-form-components.tsx` to expose the registry-based component lookup so the typed config's `componentModule` resolution continues to work.
- [ ] T017 [US1] Run `pnpm --filter @rune-langium/visual-editor test -- DataTypeForm` and confirm T010–T012 pass. Run `pnpm --filter @rune-langium/studio playwright test --grep data` and confirm visual diff against `data-baseline.png` is within tolerance. Run `pnpm --filter @rune-langium/studio playwright test --grep "data.*auto-save"` against the perf spec from T006 and confirm median timing within ±50 ms.

**Checkpoint**: User Story 1 fully functional. The Data form is the migration's template; Phase 5 (US3) can now copy this pattern. The two upstream-utility duplications (`ExternalDataSync`, `MapFormRegistry`) are gone.

---

## Phase 4: User Story 2 — Reordering attributes by drag handle (Priority: P1)

**Goal**: Wire the upstream `arrayConfig.reorder: true` plus `componentMap.ArrayReorderHandle` slot into the Data form's `members[]` array so drag-handle and keyboard reorder route through the upstream primitive. The native-DnD gesture wiring in `AttributeRow.tsx` remains as the gesture provider (R5); the migration only routes form-state updates through the upstream hook.

**Independent Test**: On a Data node with three attributes, drag the third attribute above the first; confirm the form re-renders with order [3, 1, 2], `actions.reorderAttribute(nodeId, 2, 0)` fires exactly once, and the persisted model reflects the new order. Use the keyboard reorder shortcut and confirm identical semantics. Add then remove an attribute between two reorders and confirm all three actions replay against the graph in the order they fired.

**Upstream dependency**: zod-to-form spec 010, task T014 (`ArrayBlock` reorder wiring in `packages/react/src/FieldRenderer.tsx`) and T011/T012 (`ArrayReorderHandle` component) MUST be merged before T020 begins. Verify by checking `componentMap.ArrayReorderHandle` is exported from `@zod-to-form/react`.

### Tests for User Story 2 (TDD — write first; MUST fail before T020)

- [ ] T018 [P] [US2] Add component test at `packages/visual-editor/test/editors/DataTypeForm.test.tsx`: "drag-handle reorder fires actions.reorderAttribute once with (from, to) and updates form state" — mount with three-member fixture Data node, simulate drag of row 2 to row 0, assert form state's `members` is `[m3, m1, m2]` and `actions.reorderAttribute` called once with `(nodeId, 2, 0)`.
- [ ] T019 [P] [US2] Add component test at `packages/visual-editor/test/editors/DataTypeForm.test.tsx`: "add → reorder → remove sequence replays in order" — mount, fire `addAttribute`, then drag-reorder, then click remove on the new row; assert the three action callbacks fire in the user-visible order with the correct indices each time (US2 Acceptance Scenario 3).

### Implementation for User Story 2

- [ ] T020 [US2] Update `packages/visual-editor/z2f.config.ts` for the Data form's `members` array path: add `arrayConfig: { reorder: true, onReorder: (from, to) => actions.reorderAttribute(nodeId, from, to) }` (or the equivalent declarative shape — wire `onReorder` through the `componentConfig` if `arrayConfig.onReorder` is not directly serializable). Keep existing `add`/`remove` configuration as-is.
- [ ] T021 [US2] Update `packages/visual-editor/src/components/editors/AttributeRow.tsx` so its existing `handleDragStart` / `handleDrop` / `handleDragOver` handlers (the package's owned native-DnD gesture surface) call into the upstream reorder primitive's exposed `onReorder(from, to)` instead of directly mutating `useFieldArray`. Keep the drag-handle visual (`⠿`, muted colour, hover affordance) byte-identical to the baseline (SC-004).
- [ ] T022 [US2] Run `pnpm --filter @rune-langium/visual-editor test -- DataTypeForm` and confirm T018–T019 pass. Run `pnpm --filter @rune-langium/studio playwright test --grep data` and confirm the visual snapshot still matches (the drag-handle DOM did not change).

**Checkpoint**: User Story 2 fully functional. Reorder routes through the upstream primitive; the native-DnD gesture surface and keyboard shortcuts continue to work.

---

## Phase 5: User Story 3 — Migrate Choice, Enum, Function, TypeAlias forms (Priority: P1)

**Goal**: Apply the Phase 3 template to the four other top-level form kinds. Each sub-phase ships as its own independently-deployable PR. Each form's bespoke affordances (Choice's hidden name + typeCall, Enum's name+display rows, Function's separate inputs and output sections, TypeAlias's wrapped type reference) are preserved.

**Independent Test**: For each of Choice, Enum, Function, TypeAlias — open a node of that kind, confirm the visual snapshot matches the corresponding baseline within tolerance, exercise the form's specific affordances (per Acceptance Scenarios in spec.md US3), and confirm a representative edit round-trips through to the persisted model.

**Upstream dependency**: None beyond what Phase 3 (US1) requires; the Data form template (T013) MUST be merged before any of T026/T030/T034/T038 begins so the four migrations can copy the pattern. **The four sub-phases (5a, 5b, 5c, 5d) below are mutually independent and can be picked up by four agents in parallel once T013 is merged.**

### Phase 5a: ChoiceForm (parallel with 5b/5c/5d)

- [ ] T023 [P] [US3] Add component test at `packages/visual-editor/test/editors/ChoiceForm.test.tsx`: "renders option rows with hidden name + visible typeCall.type" — mount with a fixture Choice node having two options, assert exactly two rows are rendered, assert the `name` field is hidden via the typed config, assert the `typeName` (typeCall.type) field is visible and editable.
- [ ] T024 [P] [US3] Add component test at `packages/visual-editor/test/editors/ChoiceForm.test.tsx`: "adding a choice option creates an attributes entry with hidden name and typeCall.type set" — mount, click "Add option", select a type from `<TypeSelector>`, assert `actions.addChoiceOption` fires with the chosen type and an empty/auto-generated name.
- [ ] T025 [P] [US3] Add component test at `packages/visual-editor/test/editors/ChoiceForm.test.tsx`: "external-data sync repopulates on node switch" — mirror T012 for ChoiceForm.
- [ ] T026 [US3] Refactor `packages/visual-editor/src/components/editors/ChoiceForm.tsx` to use `<ZodForm>` driving `choiceFormSchema`. Reuse the Phase 3 template: replace per-field `<Controller>` cascades, adopt `useExternalSync`, register the bespoke overrides via `componentModule`. Configure `members[].name` as hidden in `z2f.config.ts` per the Choice form's bespoke shape.
- [ ] T027 [US3] Run `pnpm --filter @rune-langium/visual-editor test -- ChoiceForm` and confirm T023–T025 pass. Run `pnpm --filter @rune-langium/studio playwright test --grep choice` and confirm visual diff and auto-save timing both within tolerance.

### Phase 5b: EnumForm (parallel with 5a/5c/5d)

- [ ] T028 [P] [US3] Add component test at `packages/visual-editor/test/editors/EnumForm.test.tsx`: "renders enum value rows with name + displayName fields" — mount with fixture Enum node, assert each row has both `name` and `displayName` inputs in the documented order.
- [ ] T029 [P] [US3] Add component test at `packages/visual-editor/test/editors/EnumForm.test.tsx`: "adding an enum value with displayName fires actions.addEnumValue then actions.updateEnumValue for the displayName" — mount, click "Add value", type name, type displayName, advance timers; assert the actions fire in order with correct args.
- [ ] T030 [US3] Refactor `packages/visual-editor/src/components/editors/EnumForm.tsx` to use `<ZodForm>` driving `enumFormSchema`. Same template as Phase 5a; configure the row to expose both `name` and `displayName` fields via the typed config.
- [ ] T031 [US3] Run `pnpm --filter @rune-langium/visual-editor test -- EnumForm` and confirm T028–T029 pass. Run `pnpm --filter @rune-langium/studio playwright test --grep enum` and confirm visual diff and auto-save timing both within tolerance.

### Phase 5c: FunctionForm (parallel with 5a/5b/5d)

- [ ] T032 [P] [US3] Add component test at `packages/visual-editor/test/editors/FunctionForm.test.tsx`: "inputs[] and output section update independently with no crosstalk" — mount with fixture Function node, edit an input row's name, advance timers, assert `actions.updateInput` fires once and `actions.setOutput` does NOT fire. Then edit the output, assert `actions.setOutput` fires once and no `actions.updateInput` fires.
- [ ] T033 [P] [US3] Add component test at `packages/visual-editor/test/editors/FunctionForm.test.tsx`: "expression-builder slot continues to render via `renderExpressionEditor` prop" — mount with a stub `renderExpressionEditor`, assert it is invoked with the documented props.
- [ ] T034 [US3] Refactor `packages/visual-editor/src/components/editors/FunctionForm.tsx` to use `<ZodForm>` driving `functionFormSchema`. Two array-like surfaces here (`inputs[]` and the single `output` section); model `output` as a non-array nested object via the typed config. Preserve the expression-builder slot wiring.
- [ ] T035 [US3] Run `pnpm --filter @rune-langium/visual-editor test -- FunctionForm` and confirm T032–T033 pass. Run `pnpm --filter @rune-langium/studio playwright test --grep function` and confirm visual diff and auto-save timing both within tolerance.

### Phase 5d: TypeAliasForm (parallel with 5a/5b/5c)

- [ ] T036 [P] [US3] Add component test at `packages/visual-editor/test/editors/TypeAliasForm.test.tsx`: "selecting a wrapped type sets typeCall.type and keeps typeCall.arguments hidden" — mount with fixture TypeAlias node, open `<TypeSelector>`, pick a type, assert the form's `typeName` field is updated and the `typeCall.arguments` path is not rendered.
- [ ] T037 [P] [US3] Add component test at `packages/visual-editor/test/editors/TypeAliasForm.test.tsx`: "external-data sync + leaf-field auto-save" — mirror T011/T012 for TypeAliasForm.
- [ ] T038 [US3] Refactor `packages/visual-editor/src/components/editors/TypeAliasForm.tsx` to use `<ZodForm>` driving `typeAliasFormSchema`. The simplest of the four; no array surface — just a name field + a wrapped-type reference. Configure `typeCall.arguments` as hidden via the typed config.
- [ ] T039 [US3] Run `pnpm --filter @rune-langium/visual-editor test -- TypeAliasForm` and confirm T036–T037 pass. Run `pnpm --filter @rune-langium/studio playwright test --grep "type-alias"` and confirm visual diff and auto-save timing both within tolerance.

**Checkpoint**: User Story 3 fully functional. All five top-level forms drive through the same `<ZodForm>` + bespoke-overrides composition. The migration's "dual-rendering surface" is closed.

---

## Phase 6: User Story 4 — Inherited attribute rows still render and work (Priority: P1)

**Goal**: Migrate the inherited (ghost) row rendering in `DataTypeForm.tsx` from the current discriminating `.map()` over `effectiveAttributes` (R6 interim fallback) to the upstream `arrayConfig.before` / `arrayConfig.after` ghost-row slots once available. Override and revert affordances continue to fire the same graph actions as today.

**Independent Test**: Open a child Data type that has a parent with three attributes and one local override. Confirm the editor shows three rows (one local override, two inherited). Click override on one inherited row; confirm it becomes a local row with inherited values pre-filled and `actions.addAttribute` fires once. Click revert on the previously-overridden row; confirm `actions.removeAttribute` fires once and the inherited row reappears in the same DOM position.

**Upstream dependency**: zod-to-form spec 010, task T038 (ghost-row rendering in `ArrayBlock` per `arrayConfig.before`/`after`) MUST be merged before T042 begins. Until upstream P2 lands, the **interim fallback** (R6) is to keep the current discriminating `.map()` over `effectiveAttributes` — that path is already correct visually and behaviourally, so the migration can SHIP without this phase if upstream P2 has not landed by Phase 5 completion.

### Tests for User Story 4 (TDD — write first; MUST fail before T042)

- [ ] T040 [P] [US4] Add component test at `packages/visual-editor/test/editors/DataTypeForm.test.tsx`: "renders N local + M inherited rows in correct order" — mount with a fixture child Data type whose parent has 2 attributes plus 1 local override, assert exactly 3 rows render in the documented order, assert the inherited rows have the dimmed appearance and "inherit indicator" matching `data-baseline.png`.
- [ ] T041 [P] [US4] Add component test at `packages/visual-editor/test/editors/DataTypeForm.test.tsx`: "override → revert round-trip fires actions.addAttribute then actions.removeAttribute" — mount, click override on an inherited row, assert `actions.addAttribute` fires once with the inherited values pre-filled, click revert on the resulting local row, assert `actions.removeAttribute` fires once and the row visually returns to inherited state.

### Implementation for User Story 4

- [ ] T042 [US4] In `packages/visual-editor/z2f.config.ts`, configure the Data form's `members[]` array with `arrayConfig.before` populated dynamically from `useInheritedMembers(data, allNodes)` so inherited rows render above local rows. Each ghost-row entry passes `{ id, render: (ctx) => <InheritedAttributeRow … onOverride={…} /> }` per row-renderer contract §6.
- [ ] T043 [US4] Update `packages/visual-editor/src/components/editors/DataTypeForm.tsx` to drop the manual `effectiveAttributes.map(entry => entry.source === 'inherited' ? <InheritedAttributeRow/> : <AttributeRow/>)` (the R6 interim fallback) in favour of the configured `arrayConfig.before` slot. Keep `packages/visual-editor/src/hooks/useInheritedMembers.ts` unchanged — it continues to derive the ghost-row list.
- [ ] T044 [US4] Update `packages/visual-editor/src/components/editors/InheritedAttributeRow.tsx` (currently inside `InheritedMembersSection.tsx` or split out — split if needed) to satisfy row-renderer contract §6: pure render, no form-state participation, exposes only `onOverride()`. Confirm visual styling (dimmed appearance, "inherit" badge, override button) is byte-identical to the baseline.
- [ ] T045 [US4] Run `pnpm --filter @rune-langium/visual-editor test -- DataTypeForm` and confirm T040–T041 pass. Run `pnpm --filter @rune-langium/studio playwright test --grep data` and confirm the visual snapshot still matches (the ghost-row DOM order and styling must be unchanged).

**Checkpoint**: User Story 4 fully functional. Inherited rows render via the upstream slot; the discriminating `.map()` is gone. If upstream P2 has not landed, this phase is skipped and the interim fallback (R6) ships in P1's MVP slice.

---

## Phase 7: User Story 5 — Section components become declarative (Priority: P2)

**Goal**: Make `AnnotationSection`, `ConditionSection`, and `MetadataSection` declarative via z2f's `section:` config + `componentModule` lookup. Register each section once on `zod-form-components.tsx`; remove all imperative section JSX from the five form bodies. This is the migration's largest single LOC reduction (~600 LOC across the three files multiplied by five form sites).

**Independent Test**: For each of the five forms, open a node and visually compare the pre- and post-migration screenshots; confirm pixel-equivalence within tolerance. Searching `packages/visual-editor/src/components/editors/` for `from './AnnotationSection'` / `'./ConditionSection'` / `'./MetadataSection'` returns zero matches inside form `*.tsx` files. Confirm each section is registered exactly once in `packages/visual-editor/src/components/forms/sections/index.ts` and resolved through `componentModule`.

**Upstream dependency**: None — this phase uses primitives that already exist in `@zod-to-form/core` (`section:` config + `componentModule` lookup). Phase C in research.md `R10` is gated only on Phase A (T007–T009) and is otherwise independent.

### Tests for User Story 5 (TDD — write first; MUST fail before T049)

- [ ] T046 [P] [US5] Add component test at `packages/visual-editor/test/editors/sections/AnnotationSection.test.tsx`: "registered AnnotationSection renders inside any form when declared in z2f.config.ts" — mount a minimal `<ZodForm>` with the section declaration, assert `data-slot="annotation-section"` is present and the legend reads identically to the baseline.
- [ ] T047 [P] [US5] Add component test at `packages/visual-editor/test/editors/sections/ConditionSection.test.tsx`: "registered ConditionSection wires onAdd / onRemove / onUpdate / onReorder via component-config props" — mount, click add, assert the `onAdd` prop fires; click remove, assert `onRemove` fires; reorder, assert `onReorder` fires with `(from, to)`.
- [ ] T048 [P] [US5] Add component test at `packages/visual-editor/test/editors/sections/MetadataSection.test.tsx`: "registered MetadataSection reads `definition`, `comments`, `synonyms` from useFormContext per section-component contract §2" — mount with a fixture form-state, assert the rendered values match form state and edits propagate via the documented commit callbacks.

### Implementation for User Story 5

- [ ] T049 [US5] Create `packages/visual-editor/src/components/forms/sections/index.ts`. Register `AnnotationSection`, `ConditionSection`, `MetadataSection` against the components module so the typed config's `componentModule` lookup resolves them by name (per section-component contract §1).
- [ ] T050 [US5] Update `packages/visual-editor/src/components/zod-form-components.tsx` to re-export the registered sections from the new `sections/index.ts` (per plan.md `Project Structure`). The re-export is the contract input the `componentModule` consumes.
- [ ] T051 [US5] Update `packages/visual-editor/z2f.config.ts` to add per-form `sections:` declarations: each form declares `[{ component: 'AnnotationSection', fields: ['annotations'] }, { component: 'ConditionSection', fields: ['conditions', 'postConditions'] }, { component: 'MetadataSection', fields: ['definition', 'comments', 'synonyms'] }]` (Function and Data have all three; Choice / Enum / TypeAlias have a subset matching today's behaviour).
- [ ] T052 [US5] Remove imperative section imports and JSX from each of the five form files: `DataTypeForm.tsx`, `ChoiceForm.tsx`, `EnumForm.tsx`, `FunctionForm.tsx`, `TypeAliasForm.tsx`. Each form's body should no longer reference `<AnnotationSection>`, `<ConditionSection>`, or `<MetadataSection>` directly — the form host renders them via the `section:` declarations from T051.
- [ ] T053 [US5] Run `pnpm --filter @rune-langium/visual-editor test -- sections` and confirm T046–T048 pass. Run `pnpm --filter @rune-langium/studio playwright test` (full visual suite) and confirm all five forms still match their baselines within tolerance.

**Checkpoint**: User Story 5 fully functional. Section components are referenced from a single registration point; no form file imports section components directly.

---

## Phase 8: User Story 6 — Custom row renderers for inline rows (Priority: P2)

**Goal**: Migrate `AttributeRow`, `ChoiceOptionRow`, `EnumValueRow`, and the function-input row to `FormMeta.render` per the upstream worked example (R3). Each row is registered against its item schema once; the form host invokes the renderer instead of the form body's `.map()` calling the row component directly. Per-row affordances (drag handle, TypeLink, TypeSelector, CardinalityPicker, debounced commit, override/revert) are preserved.

**Independent Test**: Edit any attribute row across the five forms; confirm name auto-save still debounces at 500 ms and fires the same action, type selection still navigates correctly via TypeLink, validation errors still appear inline in the same place, drag-handle and keyboard reorder still fire the same actions. Searching `packages/visual-editor/src/components/editors/` for the names `AttributeRow`, `ChoiceOptionRow`, `EnumValueRow` inside form `*.tsx` files (excluding the row files themselves) returns only the registration index file (not the form bodies).

**Upstream dependency**: zod-to-form spec 010, task T046 (custom-row-renderer worked example MDX at `apps/docs/docs/editor-primitives/custom-row-renderer.mdx`) MUST be merged before T056 begins so adopters have the documented pattern to follow. Optionally also T038 (ghost rows) if migrating `InheritedAttributeRow` registration in this phase rather than in Phase 6.

### Tests for User Story 6 (TDD — write first; MUST fail before T056)

- [ ] T054 [P] [US6] Add component test at `packages/visual-editor/test/editors/AttributeRow.test.tsx`: "registered AttributeRow renders for each item via z.registry<FormMeta>().get(memberSchema).render and reads useFormContext per row-renderer contract §2" — mount a Data form, assert each row reads its index-scoped values via the documented hooks (no manual prop-drilling).
- [ ] T055 [P] [US6] Add component test at `packages/visual-editor/test/editors/AttributeRow.test.tsx`: "focus and cursor preservation on sibling re-render" — mount, place cursor mid-input on row 1's name field, force a re-render of row 0, assert cursor position on row 1's input is unchanged (row-renderer contract §4).

### Implementation for User Story 6

- [ ] T056 [US6] Create `packages/visual-editor/src/components/forms/rows/index.ts` per row-renderer contract §1. Register `AttributeRow` against `memberSchema`, `ChoiceOptionRow` against the Choice-form member projection, `EnumValueRow` against `enumValueSchema`, and the function-input row against the Function-form member projection. Use `z.registry<FormMeta>()` from `@zod-to-form/core`.
- [ ] T057 [US6] Refactor `packages/visual-editor/src/components/editors/AttributeRow.tsx` to satisfy row-renderer contract §§2–4: read context via `useFormContext` exclusively (drop any per-form prop-drilling); receive `index` and per-row callbacks via the form host. Preserve the drag-handle gesture surface (R5 / contract §5).
- [ ] T058 [US6] Refactor `packages/visual-editor/src/components/editors/ChoiceOptionRow.tsx` to the same contract.
- [ ] T059 [US6] Refactor `packages/visual-editor/src/components/editors/EnumValueRow.tsx` to the same contract.
- [ ] T060 [US6] Extract the function-input row from `FunctionForm.tsx` (if not already split) into `packages/visual-editor/src/components/editors/FunctionInputRow.tsx` and refactor to the same contract.
- [ ] T061 [US6] Update `packages/visual-editor/src/components/zod-form-components.tsx` to re-export the registered rows from `rows/index.ts` so the typed config's `componentModule` lookup resolves them.
- [ ] T062 [US6] Remove the per-form `effectiveAttributes.map(...)` / `members.map(...)` cascades from each form body in favour of the form host's array rendering. Verify each form body no longer imports the row component directly.
- [ ] T063 [US6] Run `pnpm --filter @rune-langium/visual-editor test -- rows` (and per-row test files) and confirm T054–T055 pass. Run the full Playwright visual suite and confirm all five forms still match their baselines.

**Checkpoint**: User Story 6 fully functional. All inline row components are registered once against their item schemas; no form file imports row components directly.

---

## Phase 9: User Story 7 — Source-of-truth alignment between config and forms (Priority: P3)

**Goal**: Final state where `z2f.config.ts` and `form-schemas.ts` resolve to the same set of Zod schemas, with zero orphan references on either side (FR-008, SC-006). Phase 2 (T007–T009) did the load-bearing alignment; this phase is the final audit pass after all migrations have shipped to confirm no drift was reintroduced.

**Independent Test**: Read the typed config and the form-surface schema file together; confirm every schema imported by the config is consumed by a form, and every form's schema is imported by the config. Run a cross-reference linter that fails on orphan references.

**Upstream dependency**: None — this is a downstream-only audit/cleanup that depends on Phases 3–8 having shipped.

### Implementation for User Story 7

- [ ] T064 [US7] Add an audit script at `packages/visual-editor/scripts/audit-schema-alignment.ts` that: (a) imports `z2f.config.ts`, (b) collects every schema referenced under `include:` and `schemas.{X}`, (c) imports `form-schemas.ts`, (d) collects every exported schema, (e) asserts the two sets are equal (no orphans on either side). Exit non-zero on mismatch with a diff report. Wire it into `pnpm --filter @rune-langium/visual-editor lint` (or a dedicated `pnpm --filter @rune-langium/visual-editor audit` script).
- [ ] T065 [US7] Run the audit from T064 and resolve any orphan references. Specifically: confirm `dataTypeFormSchema`, `choiceFormSchema`, `enumFormSchema`, `functionFormSchema`, `typeAliasFormSchema` are each referenced exactly once in the typed config. Confirm `memberSchema` is the canonical row schema and `attributeSchema` / `enumValueSchema` are either consolidated with it or kept as documented stricter variants per data-model §1.
- [ ] T066 [US7] Add a developer-facing note at the top of `packages/visual-editor/z2f.config.ts` documenting the FR-008 contract: "every `include:` entry resolves to a form-surface schema in `src/schemas/form-schemas.ts`; AST schemas in `src/generated/zod-schemas.ts` are NOT consumed by forms".

**Checkpoint**: User Story 7 fully functional. The typed config and form-surface schemas are perfectly aligned; the audit script enforces this on every CI run.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Final visual-diff verification across all five forms, LOC-reduction measurement against SC-001, parity audit of the `EditorFormActions` contract, e2e regression suite, and the changeset entry.

- [ ] T067 [P] Run the full Playwright visual-regression suite from Phase 2 (`apps/studio/test/visual/forms.spec.ts`) and confirm every form's diff is below the documented tolerance. Update tolerances per-form only if justified in a brief in-PR comment.
- [ ] T068 [P] Run the full Playwright auto-save perf suite (`apps/studio/test/perf/auto-save.spec.ts`) and confirm every form's median timing is within ±50 ms of the T006 baseline (SC-007).
- [ ] T069 [P] Add Playwright integration spec at `apps/studio/test/integration/row-interactions.spec.ts` covering: drag-reorder → action emission, debounced rename → action emission, override → revert round-trip, switch-node → external-sync repopulation. This is the composite e2e regression suite called out in the user prompt.
- [ ] T070 [P] Measure LOC reduction (SC-001 ≥ 25%): run `find packages/visual-editor/src/components/editors/ -name "*.tsx" -not -name "*.test.tsx" | xargs wc -l` plus the three section components, compare against the pre-migration baseline (~5,000 LOC documented in plan.md), and assert the post-migration count is ≤ 3,750 LOC. Document the actual figure in a markdown summary at `specs/013-z2f-editor-migration/loc-report.md`.
- [ ] T071 EditorFormActions parity audit: diff `packages/visual-editor/src/types.ts:343-372` (the `EditorFormActions` contract) against the pre-migration baseline; confirm ZERO graph-action contract changes (FR-002). Document the diff (should be empty) in the same `loc-report.md`.
- [ ] T072 Run `pnpm test`, `pnpm run type-check`, `pnpm run lint`, and `pnpm run format` from repo root. Confirm zero errors and zero new warnings.
- [ ] T073 Add a changeset entry via `pnpm changeset` describing the migration as a minor bump for `@rune-langium/visual-editor`: list the deletions (`ExternalDataSync.tsx`, `MapFormRegistry.ts`, hand-rolled `<Controller>` cascades), the new public surface (`sections/index.ts`, `rows/index.ts`), and the upstream-primitive adoptions (`useExternalSync`, `arrayConfig.reorder`, `arrayConfig.before/after`).
- [x] T074 Add `packages/visual-editor/test/forms/dataform-roundtrip.test.tsx` with a pinned Data form contract in `test/forms/__snapshots__/dataform-roundtrip.json` (baseline action/schema contract: `d38d863`). Use the same source fixture as the visual suite, mount the canonical AST-backed DataTypeForm, check rendered members, invalid-name behavior, metadata commits and serialized/reparsed values. This is a semantic contract reconstructed from the pinned baseline, not an execution or pixel snapshot of the historical UI. The deleted `dataTypeFormSchema` is not reintroduced.
- [x] T075 Add `apps/studio/test/e2e/z2f-hmr.spec.ts`. Run an isolated Studio dev server with a disposable copy of the canonical generated schema and the real Pages parse handler. Change a Data name constraint and check its Inspector validation response within 2 seconds, zero navigations, and stable unrelated header DOM identity. This tests the authored layout's observable schema behavior rather than exposing an arbitrary transient schema field as a new editor control. Restore/remove disposable files in teardown. SC-011's timing/no-reload thresholds remain unchanged.
- [ ] T076 DRY-cleanup (FR-008 + R1 + R11): delete `packages/visual-editor/src/schemas/form-schemas.ts` AND every `toFormValues(node)` projection helper across `src/components/editors/`. Editors pass the graph node straight into `useZodForm(DataSchema, { defaultValues: node })` — the node is already AST-shaped, so no transformation layer is needed. Update every editor under `src/components/editors/` that previously called `useZodForm(dataTypeFormSchema, ...)` etc. to use the matching AST schema (`DataSchema`, `ChoiceSchema`, `RosettaEnumerationSchema`, `RosettaFunctionSchema`, `RosettaTypeAliasSchema`) directly. Run `grep -rE "form-schemas|toFormValues" packages/visual-editor/src/` and confirm zero matches. Run the full test + type-check + lint gate. This task is gated on Phases 3–8 having completed the editor migration; it cannot land before US1–US6 ship.
- [ ] T077 Design-tokens compliance sweep (R12): scan `packages/visual-editor/src/components/editors/` for hardcoded Tailwind colour utilities (`text-slate-\d+`, `bg-blue-\d+`, etc.) introduced or surviving the migration. Use the regex documented in research.md R12. Replace each match with the equivalent design-system primitive (Button, Badge, Input, etc.) or `var(--color-…)` reference. Add a CI check (oxlint rule or a small grep-based script) to keep the editors directory token-pure post-merge.

**Checkpoint**: Migration ready for merge. All seven priority outcomes verified; SC-001 (LOC reduction), SC-004 (visual parity), SC-006 (schema alignment), SC-007 (timing) all measured. Plus the two carryover items (T074 roundtrip parity, T075 HMR e2e) close out the deferred-context list.

---

## Dependencies & Execution Order

### Dependency graph

```
Setup (T001–T002)
    │
    ▼
Foundational (T003–T009) — baseline + schema-source unification
    │   T003–T006 = baseline capture (visual + perf)
    │   T007–T009 = schema-source unification (FR-008)
    │
    ▼
US1 — Phase 3 (T010–T017)  ── DataTypeForm migration  🎯 MVP-1
    │   ⚠ Upstream gate: z2f-010 T021 (useExternalSync)
    │
    ▼
US2 — Phase 4 (T018–T022)  ── Reorder of attribute rows  🎯 MVP-2
    │   ⚠ Upstream gate: z2f-010 T014 (ArrayBlock reorder wiring) + T011/T012 (handle)
    │
    ▼
US3 — Phase 5 (T023–T039)  ── Choice / Enum / Function / TypeAlias
    │   Four sub-phases (5a/5b/5c/5d) MUTUALLY INDEPENDENT after T013 lands
    │   FOUR-AGENT FANOUT: 5a, 5b, 5c, 5d ship in parallel
    │
    ├─► US4 — Phase 6 (T040–T045)  ── Inherited rows via ghost-row slots
    │       ⚠ Upstream gate: z2f-010 T038 (ghost-row rendering)
    │       (interim fallback per R6 — can ship without this phase)
    │
    ├─► US5 — Phase 7 (T046–T053)  ── Section components declarative
    │       (no upstream gate; runs in parallel with US3 / US4)
    │
    ├─► US6 — Phase 8 (T054–T063)  ── Custom row renderers
    │       ⚠ Upstream gate: z2f-010 T046 (worked-example MDX)
    │
    └─► US7 — Phase 9 (T064–T066)  ── Schema source-of-truth audit
            (depends on US3 + US5 + US6 having shipped)
                │
                ▼
        Polish — Phase 10 (T067–T073)
```

### Story dependency rules

- **Phase 2 (Foundational)** blocks every user-story phase. Without the captured baseline (T003–T006), there is no regression oracle for SC-004 / SC-007. Without schema-source unification (T007–T009), US1's `<ZodForm>` would resolve to AST schemas.
- **US1 (Phase 3)** is the canonical template; **US3 (Phase 5)** copies it. Therefore US3 cannot start before T013 lands — but the four sub-phases of US3 are mutually independent and can fan out in parallel.
- **US2 (Phase 4)** depends on US1 (it edits `DataTypeForm.tsx`). Reasonable to land US2 in the same PR as US1 if upstream T014 is already merged at that point.
- **US4 (Phase 6)** depends on US1 (also edits `DataTypeForm.tsx` and `InheritedMembersSection`). If upstream `010` T038 has not landed by Phase 5 completion, **the migration MAY ship without Phase 6** (interim fallback per R6 is functionally and visually correct).
- **US5 (Phase 7)** is independent of US3; it modifies all five forms but can land in parallel with the four sub-phases of US3 because the section JSX it removes is already isolated to identifiable lines in each form body.
- **US6 (Phase 8)** depends on US3 having shipped (the row components are referenced from forms whose body shape is fixed by US3) and on the upstream T046 worked example being merged.
- **US7 (Phase 9)** depends on US3, US5, and US6 having shipped (the audit script exercises the final-state config and schemas).
- **Phase 10 (Polish)** depends on all seven user-story phases landing.

### Cross-spec dependency summary (all upstream gates)

| Downstream phase | Upstream task (z2f spec 010) | What it provides                                                   |
| ---------------- | ---------------------------- | ------------------------------------------------------------------ |
| Phase 3 (US1)    | T021                         | `useExternalSync(form, source, toValues)` hook                     |
| Phase 3 (US1)    | T011 / T012                  | `ArrayReorderHandle` component (via `componentMap`)                |
| Phase 4 (US2)    | T014                         | `ArrayBlock` reorder wiring + `arrayConfig.reorder` consumption    |
| Phase 6 (US4)    | T038                         | Ghost-row rendering via `arrayConfig.before` / `arrayConfig.after` |
| Phase 8 (US6)    | T046                         | Custom-row-renderer worked-example MDX                             |

## Parallel execution opportunities

### Within Phase 2 (Foundational)

T003 and T004 can run in parallel (different files); T005 depends on both (it runs the spec they author). T006 is independent of T003–T005 and can start as soon as the studio dev server is up. T007–T009 are sequential within themselves but parallel with T003–T006.

### Within Phase 3 (US1)

- T010, T011, T012 can be authored in parallel — they live in the same test file but at non-overlapping line ranges.
- T013–T016 are tightly sequential (each modifies `DataTypeForm.tsx` or its imports).
- T017 is the verification gate after T016.

### Within Phase 5 (US3) — THE LARGEST PARALLEL OPPORTUNITY

After T013 (Phase 3) lands, the four sub-phases of Phase 5 are mutually independent and can be picked up by **four separate agents simultaneously**:

- Agent A: Phase 5a — ChoiceForm (T023–T027)
- Agent B: Phase 5b — EnumForm (T028–T031)
- Agent C: Phase 5c — FunctionForm (T032–T035)
- Agent D: Phase 5d — TypeAliasForm (T036–T039)

This is the canonical fanout opportunity in the migration. Each agent edits a single form file (`ChoiceForm.tsx`, `EnumForm.tsx`, `FunctionForm.tsx`, `TypeAliasForm.tsx`) and a single corresponding test file; there is no shared mutable state.

### Within Phase 7 (US5)

T046, T047, T048 can be authored in parallel (one per section component). T049–T052 are sequential (each builds on the registration in T049). T053 is the verification gate.

### Within Phase 8 (US6)

T054, T055 can be authored in parallel. T057–T060 (the four row refactors) can run in parallel after T056 (the registration index) lands, because each row file is independently editable.

### Within Phase 10 (Polish)

T067, T068, T069, T070 are mutually independent (different test specs / measurement passes) and can run in parallel.

## Implementation strategy

### MVP scope (User Story 1 + User Story 2 only)

1. Complete Phase 1 (Setup): T001–T002.
2. Complete Phase 2 (Foundational): T003–T009 — baseline + schema unification.
3. Complete Phase 3 (US1): T010–T017 — DataTypeForm.
4. Complete Phase 4 (US2): T018–T022 — reorder.
5. **STOP and VALIDATE**: visual diff and auto-save timing within tolerance for the Data form. The `EditorFormActions` contract is unchanged. The four-form fanout (Phase 5) is the next slice but the MVP is shippable here as a partial migration: the Data form is the most-used form, and the dual-rendering surface for the other four kinds is acceptable per the spec's slice-shipping principle (Assumptions §5).

The MVP delivers the largest single LOC reduction (the Data form is 471 LOC + the deleted `ExternalDataSync.tsx` + `MapFormRegistry.ts`) and proves the pattern.

### Incremental delivery (post-MVP)

- **Slice 2**: Phase 5 (US3) — four-agent fanout for the other four forms. Each ships as its own PR.
- **Slice 3**: Phase 7 (US5) — section components declarative. Largest single LOC win (~600 LOC).
- **Slice 4**: Phase 6 (US4) — ghost rows via the upstream slot, gated on upstream `010` T038.
- **Slice 5**: Phase 8 (US6) — custom row renderers, gated on upstream `010` T046.
- **Slice 6**: Phase 9 (US7) + Phase 10 (Polish) — schema-alignment audit + final verification.

### Constitution gates per release

- All five constitution principles re-checked at each merge per `plan.md`'s Constitution Check.
- TDD enforced: each user-story phase's test tasks land before the corresponding implementation tasks.
- Visual-regression diff (SC-004) and auto-save timing budget (SC-007) verified per slice.

## Format validation

Every task above:

- ✅ Starts with `- [ ]` checkbox
- ✅ Has a sequential `T###` ID (T001–T073, total 73 tasks)
- ✅ Uses `[P]` only for parallelizable tasks
- ✅ Uses `[US#]` only for user-story-phase tasks (Phases 3–9); Setup/Foundational/Polish use no story label
- ✅ Includes an exact file path in the description
- ✅ Phases that depend on upstream z2f-010 work cite the specific upstream task ID(s)
