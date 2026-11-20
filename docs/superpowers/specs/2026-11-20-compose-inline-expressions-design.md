# Inline expression editing in Compose

## Outcome

Authors can open a function in Compose, see which expressions are editable, and
change a value, add a member path, or insert a primitive without leaving the
current row. The viewer keeps the surrounding statements in Rune so aliases,
assignments, predicates and call arguments retain their meaning in context.

This extends the existing expression editing design and uses its source ownership
and revision rules. The pinned CDM starter’s ordinary `AccrueNoteInterest` function supplies
the `note -> payout` alias and period filter. The annotated
`AnalyseFloatingRateNote` supplies the `market -> asOf` argument to
`AccrueNoteInterest` for testing both views. Studio’s named-argument fixture
supplies the five inputs of `InterpolateLinear`.
[Expression editing design](2026-10-08-expression-editing-design.md)
[Pinned CDM note](https://github.com/daikonic-org/rune-cdm-example/blob/bbe3ba6665ddca9fda31dc5d0480135264a79fa7/model/note-valuation.rosetta)

## Approaches

| Approach                                  | Tradeoff                                                                                                                                                                                                    |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Improve the existing dialog               | Reuses the current draft host and provides space for large expressions. Authors still have to find an expression and open a separate surface.                                                               |
| Use Canvas for every expression           | Puts step dependencies and expression structure in one graph. Small member paths, predicates and arithmetic consume nodes and compete with the function’s flow.                                             |
| Share Compose controls with inline Source | Keeps the expression in its statement, gives Canvas the same editor for the selected step and uses one palette and binding picker. It requires a shared draft target and a reliable mapping back to Source. |

The review selected inline Source with shared Compose controls. **Source** opens
with expression rows and named arguments expanded. **Canvas** remains the view
for steps and connections. Both views reflect one draft for the same function.

## Workflow

- **Open in Compose** from a function’s Inspector or Source resolves its owning
  declaration and opens Compose Source. When the entry point has an expression
  target, focus that row. Otherwise the body shows its editable expressions
  without requiring a caret position. The statement supplies the row label.
- Keep alias values, preconditions, `set` and `add` values, and postconditions
  in source order. Each row and argument group can be collapsed. Open rows render
  lightweight chips and mount text editing on demand.
- A normal click selects the expression or opens the clicked token’s dropdown.
  The `if` chip chooses the branch primitive. The predicate chip can switch
  between `is absent` and `exists` with the same branch values. A filter exposes
  its input, predicate fields and operators, and the operation that consumes its
  result. Only offer transformations whose existing operands can be preserved or
  whose new required slots can be shown explicitly.
- **+ Expression** starts a new alias at the grammar-valid insertion point in
  a function body. It accepts a typed expression or a starter from the palette.
  In a data condition, the equivalent action uses the condition creation flow.
- A user can type on a focused value and continue editing it in place.
  **Edit Rune** is the explicit fallback for typing an entire expression or
  editing a subtree without a structural control. Preserve its exact Rune text
  in that subtree. The rest of the body stays interactive.
- For a selected data type, use the same inline editor in a declaration-scoped
  region in Explore Source. Reuse the existing condition creation draft. The
  full-file Rune editor is available through the explicit Source action.

## Shared palette and variable selection

Keep Compose’s palette open by default on desktop and honor the panel’s saved
visibility and width once adjusted. Use the existing responsive panel toggle at
narrow widths. The active expression slot supplies the target, so invoking a
palette item can add a canvas step or fill a specific expression slot through
the appropriate existing edit path. Reuse the existing primitive IDs and starter
construction. Result-only canvas controls appear in the canvas context.
[Compose palette](../../../apps/studio/src/components/compose/FunctionPalette.tsx)
[Compose primitives](../../../apps/studio/src/components/compose/composition-primitives.ts)
[Expression starters](../../../packages/visual-editor/src/adapters/expression-starters.ts)

Extend Compose’s argument variable selector into a shared picker. Resolve the
in-scope variable by identity, then let the user step through the receiver’s
linked members. Show a breadcrumb and effective type and cardinality at each
step. A compatible object can be selected at its current level. Browsing can
continue through a complex value while the completed path still needs to fit
the target. For a single date, `market -> asOf` can fill the slot, and
`market -> quotes -> maturityDate` remains browsable with collection cardinality.
Use the same picker for the node argument, the inline slot dropdown and the
active variable target in the palette.
[Existing variable control](../../../apps/studio/src/components/compose/CompositionNode.tsx)
[Rune scope provider](../../../packages/core/src/services/rune-dsl-scope-provider.ts)

Resolve scope at the active linked subtree. The worker's current top-level
expression request needs to carry this target so aliases, closure parameters
and implicit item members reach the picker. For an unconstrained slot, offer
its scoped candidates and use the canonical validation path when applying.

## Source and draft behavior

Use the current parser, linker and scope provider for expression availability
and for aliases in declaration order. Keep the existing document identity and
map each expression and token to the captured Rune range. Highlight the matching
range in the visible Rune view on hover or focus. Flatten visual chains without
changing the parsed tree, and show grouping where precedence or collection
scope changes. Moving focus goes across visible chips. Enter opens a slot,
Escape returns focus, and ordinary text-editing keys work inside the inputs.

Reuse the guarded source edit transaction. One function owns one active
expression or step draft at a time. Changing views preserves the draft and
its insertion or replacement target. Canvas shows an active step draft
through its existing preview. A Source-only row such as a precondition keeps
its draft for resuming on return to Source. Apply or Discard before replacing
a dirty target. A single Apply creates one undo entry in the document editing
session, available from either Compose view after switching. Retain an
invalid or stale draft with its diagnostic.

An edit that changes a Canvas step uses the existing linked candidate check
from either view. Source-only expression Apply follows the current Builder’s
syntax and revision checks, with linker diagnostics reported through the
normal Source pipeline. This lets authors repair one expression at a time.
Scope, member and validation responses are compared against the current
declaration, file revision and dependency snapshot. Read-only source remains
browsable. Each rendered expression uses the `code` font token with Daikonic
Transit Code Book, including chips, argument labels and text fields.
[Expression document](../../../apps/studio/src/services/expression-document.ts)
[Rune source regions](../../../packages/core/src/utils/source-regions.ts)

Function Source editing is available for ordinary functions with a uniquely
resolved expression owner, including functions with nested assignments or
accumulation. A dispatch variant keeps its concrete declaration in full-file
Rune Source since the current expression owner lookup resolves the base
declaration of a dispatch group. Graph editing uses the linked body eligibility
check. Whether the `[composition]` marker becomes optional for Canvas
eligibility is a separate delivery decision.
[Canvas eligibility](../../../packages/core/src/api/function-composition.ts)

## Acceptance

1. A function opens in Compose Source with editable rows visible and the desktop
   palette open in a new layout. A phone user can open the same palette.
2. Choose `note -> payout` in the ordinary function’s Source. Edit the
   `market -> asOf` argument in the annotated function and see the same draft
   in Canvas and Source. Collection paths show their effective cardinality
   and stay unavailable for scalar slots.
3. The filter’s field, comparison, logic and result dropdowns edit their own
   portions of the expression. Selecting a primitive or a predicate leaves
   the other branch values intact. A text fallback opens only through an
   intentional edit action and preserves the current expression.
4. Typing and primitive insertion work from the same row. Validate named slots,
   new aliases, keyboard navigation, touch selection and narrow wrapping.
5. Exercise multi-file ownership, CRLF ranges, undo, stale and invalid drafts,
   and read-only references through the existing Studio and core test seams.
