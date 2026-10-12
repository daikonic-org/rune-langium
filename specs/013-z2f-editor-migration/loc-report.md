# LOC Reduction Report — feature 013-z2f-editor-migration

**Generated**: 2026-04-25
**Baseline commit**: `d38d863` (chore(deps): bump @zod-to-form/{core,react} to ^0.8.0, the commit _immediately before_ Phase 3 / US1 began)
**Final commit**: `1ba9631` (013-z2f-editor-migration HEAD)
**Spec target**: SC-001 — total LOC in editor forms folder MUST decrease by ≥25%

## Current acceptance decision (October 11, 2026)

The user superseded SC-001's 25% LOC requirement with a qualitative DRY assessment: identical subnodes use the same constructs, including attributes, annotations, inheritance and synonyms, and share header/footer/navigation. The historical measurements below are retained as history; they are not the present acceptance gate. See the [#562 implementation assessment](../../docs/investigations/2026-10-12-inspector-562-assessment.md). Its current behavior/test evidence must pass before #562 closes.

## Historical summary

**SC-001 is NOT met.** Editors LOC went from **5,868 → 6,052**, a net change
of **+184 lines (+3%)**. The migration prioritised parity (FR-012/SC-004) and
end-user behavioural unchanged-ness over aggressive LOC reduction.

| Phase target                                | Outcome                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------ |
| ≥25% reduction (SC-001)                     | ❌ +3% increase                                                          |
| ZERO end-user-visible regressions (FR-012)  | ✅ all 651 tests still pass                                              |
| ZERO graph-action contract changes (FR-002) | ✅ EditorFormActions diff empty                                          |
| All AST-canonical (R1, FR-008)              | ✅ form-schemas.ts deleted; identityProjection helper for all five forms |
| Custom rows via FormMeta.render (US6)       | ✅ 4 row renderers registered                                            |
| Sections declarative (US5)                  | ✅ section: config + componentModule wired                               |
| Inherited rows via ghost rows (US4)         | ✅ arrayConfig.before in DataTypeForm                                    |
| Reorder via z2f primitive (US2)             | ✅ arrayConfig.reorder true on attributes[]                              |

## Per-file deltas

Largest reductions and growths by file:

| File                                             |  Baseline |     Final |        Δ |
| ------------------------------------------------ | --------: | --------: | -------: |
| `FunctionForm.tsx`                               |       711 |       550 | **−161** |
| `EnumForm.tsx`                                   |       400 |       368 |  **−32** |
| `DataTypeForm.tsx`                               |       471 |       530 |      +59 |
| `AttributeRow.tsx`                               |       348 |       397 |      +49 |
| `MetadataSection.tsx`                            |       231 |       288 |      +57 |
| `AnnotationSection.tsx`                          |       136 |       187 |      +51 |
| `ConditionSection.tsx`                           |       396 |       475 |      +79 |
| `EnumValueRow.tsx`                               |       283 |       287 |       +4 |
| `TypeAliasForm.tsx`                              |       243 |       233 |      −10 |
| `ChoiceForm.tsx`                                 |       283 |       283 |        0 |
| **New: `FunctionInputRow.tsx`**                  |         — |        88 |      +88 |
| Other (TypeSelector, expression-builder/*, etc.) | unchanged | unchanged |        0 |

(Outside `editors/`: new helper files in `forms/sections/` and `forms/rows/`
add ~250 LOC. The two deletions — `forms/ExternalDataSync.tsx` (65 LOC) +
`forms/MapFormRegistry.ts` (~50 LOC) + `schemas/form-schemas.ts` (147 LOC)

- `test/schemas/form-schemas.test.ts` (~280 LOC) — net to roughly +0 LOC
  across the rest of the package.)

## Why SC-001 missed

The migration's per-form changes broke roughly even because three things
each _added_ LOC:

1. **Section components grew** (Annotation +51, Condition +79, Metadata
   +57). Phase 7 made them work in _both_ the old prop-callback path
   (still used by the imperative JSX in the forms) **and** the new
   declarative `section:` path (back-compat fallback via
   `EditorActionsContext`). The dual-mode adds branches; the per-form
   imperative inclusion was kept intentionally to ship the migration
   safely. Cleanup belongs in a follow-up that removes the imperative
   `<AnnotationSection ...>` / etc. from each form's body once visual
   parity is independently verified — see "Future LOC opportunity"
   below.
2. **AttributeRow grew** (+49) because it now reads AST paths
   (`attributes.${i}.typeCall.type.$refText`, `attributes.${i}.card`)
   and translates `RosettaCardinality { inf, sup, unbounded }` ↔ the
   `(0..*)` string the `<CardinalityPicker>` API accepts. The
   translation costs lines but preserves the
   `EditorFormActions.{addAttribute,updateAttribute}` contract
   (FR-002).
3. **DataTypeForm grew** (+59) because `useFieldArray({ name:
   'attributes' })` over the AST shape requires more explicit
   construction (`makeAttributeAstItem` builder for new rows, `useRef`
   tracking of the AST `superType.$refText` shape, etc.) than the
   projection's flat `members[]` did.

The single reduction worth highlighting is **FunctionForm −161** —
removing the imperative section JSX cascade _did_ shrink that file
notably; it was the largest pre-migration form (711 LOC) so the
absolute drop is visible.

## Future LOC opportunity (out of this feature's scope)

A follow-up that removes the imperative `<AnnotationSection
onAdd={...} onRemove={...}>` (and the equivalent
`<ConditionSection>`, `<MetadataSection>`) JSX from all five forms,
relying entirely on Phase 7's declarative `section:` config to render
them, would:

- Drop ~30–50 LOC of section invocation JSX per form (~150 total)
- Allow the section components themselves to drop the prop-callback
  back-compat path (~30–50 LOC each, ~120 total)
- Estimated total: ~270 LOC reduction → would put us at roughly **5,782
  LOC final, a ~1.5% drop**, still well short of the SC-001 25% target

**Recommendation**: revise SC-001 down to a parity-or-better goal (≤+5%
LOC change), or treat the spec's 25% target as aspirational and
explicitly waived by FR-012 (visual parity) which we did meet. The
real-world wins from this migration are not LOC: they are
single-source-of-truth schema canonicalisation (R1), zero hand-rolled
form plumbing on the validation path, and the open door for the
`?z2f` build-time pipeline to take over rendering (deferred,
inspector-z2f-migration scope).

## Method

```bash
# baseline (commit immediately pre-Phase-3)
git show d38d863:packages/visual-editor/src/components/editors/<file>.tsx | wc -l

# final
find packages/visual-editor/src/components/editors -name "*.tsx" \
  -not -name "*.test.tsx" -exec cat {} \; | wc -l
```

---

## T071 — EditorFormActions parity audit

`git diff d38d863..013-z2f-editor-migration -- packages/visual-editor/src/types.ts`
returns **zero changes**. The graph-action contract is byte-identical
between the pre-migration baseline and the final 013 head. **FR-002
satisfied.**

## Follow-up measurement — 2026-10-06 (#562)

The configured-section consolidation removes 148 lines from the current editor
folder: **7,560 → 7,412**. Counting the same recursive `.tsx` folder against
`d38d863` still yields **5,868 → 7,412 (+26.31%)**. SC-001's 25% reduction is
**not met and not waived**; the folder has also gained features since the
original migration measurement. No issue closure should imply that target passed.

The Inspector now resolves section placement from one shared configuration and
the upstream section renderer. Standalone callback props remain a public API;
removing them would break component consumers, rather than remove duplicate
Inspector wiring. Behavior coverage includes all existing form tests and a
pinned Data form round-trip contract using the visual baseline fixture.

The browser HMR check changes a canonical schema constraint, types into the
Inspector and checks the resulting validation message within two seconds.
It preserves the actual header DOM node and records zero document navigations.
This exercises the authored Inspector layout's schema behavior instead of
expecting an arbitrary new schema property to become an editor control.
