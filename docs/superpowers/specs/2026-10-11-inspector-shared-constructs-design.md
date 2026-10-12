# Shared Inspector constructs and selected-child details

**Date:** 2026-10-11
**Issue:** [#562 — Inspector consolidation](https://github.com/pradeepmouli/rune-langium/issues/562)
**Related navigation regression:** [#595 — wrong curated Source after hydration](https://github.com/pradeepmouli/rune-langium/issues/595), added to the plan at the user's request on 2026-10-12.
**Status:** Written spec approved on 2026-10-12; implementation plan pending review.
**Source snapshot:** `5812283ab9b81563b737291c6860e6db825a9c87`.

## Intent and success criterion

Make the Inspector consistent across declaration kinds and their children.
Identical constructs must use one authoritative editing implementation:
attributes, documentation, annotations, synonyms and inheritance. Shared header,
footer and navigation composition must give those editors consistent placement
and behavior.

The user explicitly replaced #562's original 25% LOC reduction criterion with a
qualitative assessment of construct reuse and retained behavior. LOC remains
supporting evidence, not an acceptance threshold. This revision governs the
continuation described here; the original
[migration spec](../../../specs/013-z2f-editor-migration/spec.md) and
[LOC report](../../../specs/013-z2f-editor-migration/loc-report.md) remain historical
evidence of that migration. Consolidation is not complete merely because a hook
or schema is shared while controls, validation or mutations remain duplicated.

## Current state

The five declaration EditorForms use canonical generated AST schemas,
`useZodForm`, the shared L1 validation policy and `EditorFormProvider`.
Configured sections already render through upstream `SectionRenderer`.
The pinned `dataform-roundtrip` test and `z2f-hmr` browser check already exist;
the issue's older description of those checks as absent is stale.

Relevant implementation seams:

| Seam                                                                                                                                                                                      | Current responsibility                                                    | Design consequence                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [TypeHeader](../../../packages/visual-editor/src/components/TypeHeader.tsx)                                                                                                               | Shared declaration identity and navigation controls                       | Reuse it in a common frame; standardize composition rather than create another header.                      |
| [EditorFormPanel](../../../packages/visual-editor/src/components/panels/EditorFormPanel.tsx)                                                                                              | Kind routing and form boundary                                            | Host the common frame without moving domain behavior into Studio.                                           |
| [Section config](../../../packages/visual-editor/src/components/forms/sections/config.ts)                                                                                                 | Authoritative section field assignments                                   | Extend this authority to shared placement and supported targets. Generated and custom forms must not drift. |
| [EditorFormProvider](../../../packages/visual-editor/src/components/forms/EditorFormProvider.tsx)                                                                                         | Canonical schema lookup and field validation                              | Both member rows and details bind through this existing bridge.                                             |
| [AttributeRow](../../../packages/visual-editor/src/components/editors/AttributeRow.tsx)                                                                                                   | Attribute controls, including editable function inputs                    | Consolidate around the existing construct, retaining inherited/override behavior.                           |
| [Row registry](../../../packages/visual-editor/src/components/forms/rows/index.tsx)                                                                                                       | Schema-aware row composition                                              | Reuse it with the form's existing dispatch bindings.                                                        |
| [MetadataSection](../../../packages/visual-editor/src/components/editors/MetadataSection.tsx) and [EnumValueRow](../../../packages/visual-editor/src/components/editors/EnumValueRow.tsx) | Documentation and synonym interactions, with different AST synonym shapes | Share interaction controls with typed semantic bindings.                                                    |
| [Editor store](../../../packages/visual-editor/src/store/editor-store.ts)                                                                                                                 | Canonical graph mutations, patches, undo and reconciliation               | Extend target-aware operations here; do not add a parallel child store.                                     |
| [Source renderer](../../../packages/visual-editor/src/serialize/cst-reuse-renderer.ts)                                                                                                    | CST reuse and shared structural rendering for source synchronization      | All child metadata edits retain this source-writing path.                                                   |

Most common metadata actions currently take a declaration `nodeId`; sections
also assume root form paths. General child metadata editing therefore requires
target-aware bindings and mutation capability, not just extracting JSX.
Enum-value synonyms already have a specialized child action; its semantics must
be retained when routing through the shared editor.

## Agreed Inspector layout

The Inspector uses one common frame:

1. Declaration header: namespace, name, kind and existing relevant actions.
2. Kind-appropriate section navigation and main content.
3. A resizable, collapsible details pane at the bottom of member sections.
4. A shared footer outside the details pane, reporting save/validation status.

The host supplies persistence status. Standalone consumers that do not provide
that status omit it rather than inventing a successful save indication.

Use tabs when there are multiple substantial sections. Simple forms can use
stacked sections within the same frame; do not manufacture empty tabs or impose
the Data layout on every kind. The shared section configuration owns placement.
The initial implementation must preserve all existing function implementation,
condition, input/output and projection surfaces.

### Curated navigation prerequisite (#595)

Explorer, Inspector and Source must remain on the same selected declaration
through namespace hydration and cached reload. The Source file must come from
the declaration's authoritative document ownership, not the first file matching
its bundle and namespace. A deferred catalogue path may be replaced by that
resolved ownership once hydration finishes; file-only navigation keeps its
explicit file identity. Newer selection, file navigation or workspace changes
supersede older requests.

For `BusinessCenters` and `Counterparty`, show their actual type file even when
the enum file appears first in the hydrated namespace. For `Abs`, retain the
complete original source file and reveal the function's declaration once source
and its matching editor view are ready, including after a cached reload. A
correct Inspector heading does not by itself prove either Source behavior.
Keep source loading lazy to the active namespace and existing caches intact;
do not fetch the full source closure or substitute a rendered declaration for
the original file. The function reveal failure requires separate reproduction:
the issue's common-cause explanation remains a hypothesis.

### Member rows and selection

- Name, type and cardinality stay directly editable in each applicable row,
  using the existing controls. Enum rows retain the value name, ordering and
  existing relevant actions; their display name/label moves to details.
- Selecting a row displays its documentation, annotations and synonyms below.
  The selected row and details heading make the target explicit.
- Enum-value details also expose the existing canonical `display` field as
  Display name. It is presentation metadata, separate from the enum value's
  identifier; do not invent an additional `labels` property. Changing or
  clearing it uses the same declaration form, validation and mutation/source
  path. Renaming/reordering a value preserves its display name, and inherited
  display names remain inspectable without editing the ancestor.
- Focusing a row control selects that row without stealing focus or interfering
  with the control. Row navigation keys must not intercept typing, picker
  navigation or CodeMirror input.
- Keep one selected child per active member section. Reordering or renaming it
  retains selection. Removing it clears the pane's target.
- Changing declaration, workspace or member section clears child selection.
  Declaration-level Documentation/Metadata sections always target the
  declaration, regardless of a previous child selection.
- With no child selected, the lower pane is collapsed; its heading indicates
  that a member can be selected. Selecting a child opens its details.
- The lower pane has no additional tab system. Its supported sections stack
  vertically, with one scroll area. The list above has its own scroll area.
- Resize and collapse controls work with pointer, touch and keyboard input.
  Minimum sizes preserve usable member and detail areas. Narrow Inspectors use
  the same vertical arrangement rather than a popup or extra side column.
- Pane size/collapse preference is UI state only. Child identity, AST payloads
  and form drafts must not enter persisted layout settings. Reuse the existing
  workbench preference mechanism if persistence is needed.

The bottom pane is used for Data fields, enum values and function inputs, and
for other child kinds only where their canonical schema supplies these
constructs. A Choice option without a supported metadata property does not gain
an artificial one.

## Shared constructs and component boundaries

Reusable Inspector components and form bindings belong in the MIT
`packages/visual-editor` package. Studio remains the source-available host,
supplying its existing workspace, persistence and source/editor services.
Design-system primitives own presentation; they do not acquire Rune AST logic.

| Construct                      | Shared implementation responsibility                                    | Variation supplied by bindings                                                                  |
| ------------------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Header/footer/navigation       | Consistent frame, status and section composition                        | Declaration identity, supported sections, capabilities and host status/actions.                 |
| Attributes and function inputs | Existing member controls and row interaction                            | Collection/path, current child identity, inherited/override state and callbacks.                |
| Type/cardinality controls      | Existing selectors and canonical conversion helpers                     | Supported values, schema path and read-only state; no duplicate normalization.                  |
| Documentation                  | Definition editor and supported documentation controls                  | Target path and canonical schema; preserve unexposed documentation/reference fields.            |
| Display name/label             | Schema-bound optional display control in selected-item details          | Enum-value `display` capability; no artificial field on other canonical types.                  |
| Annotations                    | One annotation editing interaction                                      | Canonical annotation shape, arguments/qualifiers where supported, scope and editing capability. |
| Synonyms                       | Source/value selection and add/remove/edit interactions                 | Class, enumeration and enum-value AST representations and required values.                      |
| Inheritance/inherited members  | Shared parent selection and provenance presentation                     | Applicable parent kind, effective members and existing override operations.                     |
| Conditions/errors              | Existing shared condition editors and one consistent error presentation | Data/function owner, pre/post-condition kind and existing expression bindings.                  |

A shared construct may use typed variants when the grammar differs. For example,
class synonyms and enum-value synonyms must not be coerced into one lossy AST
payload. Typed variants belong at the semantic binding, not in a second set of
interaction controls or independent validation rules.

Reuse the existing zod-to-form configuration, public `SectionRenderer`, row
registry and `EditorFormProvider` bridge. This design does not require replacing
all specialized layouts with fully generated forms in one migration.
Existing public standalone section and row callback APIs remain supported as
thin bindings to the canonical components; preserving them must not preserve a
second editor implementation.

## Form ownership and child targets

Each declaration retains one canonical form state and provider. The upper rows
and lower details controls bind to that same form, using the resolved child's
current nested path. The lower pane must not create a second `useZodForm`, copy
the AST into a private editable model or maintain independent validation state.

The selection/binding layer carries the active owner, child kind and current row
identity. Resolve its current collection/path before every edit. A numeric array
index captured when selection occurred is not an editing identity.

Within the mounted form, use its existing row identity and current field-array
mapping. A rename updates the committed child locator and selection together;
a reorder resolves the same row at its new position. After external reparse or
form reconciliation, retain the target only when it can be uniquely matched to
the current owner and child. An ambiguous or removed target clears selection
instead of guessing. No new persisted IDs or global child-identity store are
required.

Bindings expose the canonical target schema, form prefix, supported constructs,
read-only/inherited capabilities and typed mutation callbacks. The UI must not
infer capability merely because an arbitrary property happens to exist.
Annotation scopes and synonym references use the existing owning declaration
and namespace resolution; a child cannot reuse a declaration-only annotation
just because the UI lists it.

## Mutation, source and persistence flow

For a valid committed edit:

1. Resolve the target against the current declaration/workspace and current
   child mapping; reject a stale or ambiguous target.
2. Validate the value through the generated canonical schema and existing
   field-validation bridge. Preserve dedicated validation for existing loose
   editor fields.
3. Execute a typed editor action through `mutateGraph`, using authoritative
   generated DomainOps and existing semantic construction helpers where
   available. Shared annotation/synonym construction must not be recreated
   independently in each form or optimistic UI branch.
4. Let the existing patch, undo/reconciliation, source-sync and persistence
   paths carry the change. Child metadata edits must be represented in those
   paths just like basic attribute edits.
5. Reflect the committed state and current errors in the same declaration form.

Existing root actions delegate to these shared bindings where suitable; they
retain their public behavior. Operations must preserve unknown or unexposed AST
fields, annotation arguments/qualifiers, reference text and the correct synonym
variant. Tests must exercise rich existing payloads, not only empty tag arrays.

Source rendering continues through CST reuse and the canonical codegen renderer.
Do not introduce a local pretty-printer, rebuild a namespace from UI summaries
or approximate unsupported constructs. Untouched siblings, source comments and
expression bodies remain intact. The structurally edited construct may adopt
the existing canonical formatting; semantic content and comment text must not
be discarded. Comments attached to a moved child retain their ownership rather
than becoming another child's comments. Any source-fidelity gap exposed by the
required tests is fixed in the existing owning rendering/source seam.

### Comments stay in code

Authored comments remain editable in the Source editor and existing code-region
editors. They are not an Inspector control and are not invented AST fields.
Documentation remains editable through the DSL's canonical documentation data.

The current `updateComments` action writes Studio-only `node.meta.comments`.
This redesign does not add child notes or reinterpret that metadata as source
comments. Do not delete or migrate existing stored notes or remove their public
API solely for consolidation. The redesigned Inspector excludes the Studio
Comments control from its shared metadata placement.

### Drafts and failure behavior

- Invalid field values show errors on their controls and contribute to the
  common error/status presentation. They must not commit to another child or
  produce invalid source through an optimistic mutation.
- Switching selected children within the same form retains each child's
  invalid draft and errors in the declaration form. Existing declaration and
  workspace lifecycle rules remain authoritative; this change does not create
  a cross-workspace draft store.
- A missing capability or read-only target disables mutation controls. Inherited
  members use the same detail components for inspection. Editable local
  overrides use the existing explicit override path; never mutate the base
  declaration through an inherited row.
- Curated read-only behavior and deferred source ownership remain intact.
- Source/persistence errors remain visible and retryable through existing host
  behavior. Retain the persistence debounce and workspace save barrier; do not
  add a second timer or a new Save button.
- Selection changes and pane collapse must not discard form state, remount an
  unrelated expression editor or issue unnecessary worker/LSP requests.

## Acceptance and verification

### Qualitative assessment

Review every applicable owner of each construct in the matrix above. Record the
canonical component/binding and confirm that another owner delegates to it.
Review header, footer, navigation, inherited/read-only presentation and empty
states across Data, Enum, Choice, Function, TypeAlias and read-only Other forms.
Kind-specific section composition is expected; duplicated behavior for the same
construct is not.

The final implementation report must identify deliberate semantic variants and
remaining exceptions. No behavior is removed to reach a LOC target. Source-shape
or import-count assertions cannot replace public-behavior tests.

### Required behavior checks

| Area                | Evidence required                                                                                                                                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Child ownership     | Edit metadata on one field, rename/reorder it, then edit again; only the intended child changes. Remove the selected child and change declaration/workspace; stale callbacks never edit another owner.                                          |
| Shared semantics    | Exercise applicable declaration/child documentation and annotations, class/enum/enum-value synonym shapes, Data attributes and function inputs through their real form bindings. Preserve rich payloads and reject unsupported target variants. |
| Enum display names  | Edit and clear canonical `display` in details; retain it through value rename/reorder, undo/reparse and reload. Keep its editable control out of the row and inherited values read-only until explicitly overridden.                            |
| Validation/drafts   | Canonical identifier unions, optional fields, invalid metadata drafts and field-array operations retain existing L1 coverage. Switching child selection preserves invalid drafts without committing them.                                       |
| Source round-trip   | Serialize and reparse actual edited Rune, then reload the workspace. Metadata, references, inherited/override semantics, sibling content, code comments and untouched expressions survive.                                                      |
| Undo/reconciliation | Undo/redo and reparsing during consecutive child edits preserve the right values and ownership; no edits are dropped or replayed onto a different field.                                                                                        |
| Persistence         | Existing trailing debounce and save barriers retain the latest valid child edits across reload and workspace transitions, including storage failure/retry behavior.                                                                             |
| Read-only           | Inherited and curated children show the same supported detail sections without unauthorized mutations; local override edits retain their existing rules.                                                                                        |
| UX                  | Keyboard selection/control focus, divider resize/collapse, long lists, empty selection and narrow panels work; details always name the current child. Header/footer remain consistent and expression sessions stay mounted appropriately.       |

For #595, include exact curated type-file selection on cold hydration,
deferred-path replacement, cancellation on rapid/file/workspace navigation, and
visible `Abs` declaration reveal after cached reload without source refetch.
Use the original nightly J04a/J04b/J20 assertions as regression requirements;
keep issue-reported production evidence separate from new local validation.

Extend existing public-behavior tests at the relevant seams:

- [Attribute row tests](../../../packages/visual-editor/test/editors/AttributeRow.test.tsx),
  [synonym section tests](../../../packages/visual-editor/test/editors/MetadataSection-synonyms.test.tsx)
  and [panel tests](../../../packages/visual-editor/test/editors/EditorFormPanel.test.tsx).
- [Pinned form parity](../../../packages/visual-editor/test/forms/dataform-roundtrip.test.tsx),
  [mutation tests](../../../packages/visual-editor/test/store/mutate-graph.test.ts)
  and [reconciliation tests](../../../packages/visual-editor/test/store/edit-reconcile.integration.test.ts).
- [Source round-trip tests](../../../packages/visual-editor/test/serialize/cst-reuse-serializer.test.ts)
  and [expression fidelity tests](../../../packages/visual-editor/test/serialize/cst-reuse-expression-fidelity.test.ts).
- Studio browser journeys for the selected-child details layout, alongside the
  existing [HMR check](../../../apps/studio/test/e2e/z2f-hmr.spec.ts) and expression
  journeys. Use hermetic licensed corpus slices for source-rich examples;
  `.resources` is optional, not a mandatory external checkout.

Implementation validation includes affected visual-editor/Studio tests,
lint/format/type checks and browser journeys. If canonical rendering changes,
run the relevant codegen checks and rebuild its dist output before validating
consumers. Local evidence, hosted-LSP coverage and production evidence are
reported separately. This document does not claim these planned checks passed.

## Boundaries and follow-through

This work consolidates Inspector constructs and adds supported child metadata
bindings. It does not change codegen expression semantics, redesign the Builder,
add a comments subsystem, change workspace storage formats, add dependencies or
turn on L2/Zod compilation. [#574](https://github.com/pradeepmouli/rune-langium/issues/574)
remains the separate L2 adoption issue.

After implementation, update the existing migration/follow-up documentation and
agent architecture guidance to reflect actual section ownership, comment
placement and target bindings. Update #562's stale description and record the
explicit qualitative acceptance revision, then close it only when the construct
assessment and required behavior evidence are complete. Keep separate persistence
incidents and production checks independently tracked.

## Review handoff

The user approved the architectural direction, bottom details pane, inline basic
row properties, code-only comments and acceptance scope. This written spec must
be reviewed before creating the implementation plan. After written-spec approval,
use `superpowers:writing-plans`; implementation starts after plan review and
execution-method selection. No product code was changed during brainstorming.
