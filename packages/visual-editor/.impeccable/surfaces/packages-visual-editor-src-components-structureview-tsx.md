---
version: 1
slug: 'packages-visual-editor-src-components-structureview-tsx'
primary_target: 'src/components/StructureView.tsx'
related_targets: ['src/styles.css', 'src/adapters/structure-graph-adapter.ts']
---

# Structure document

Mode: Operate. Preserve Studio's palette, typefaces, compact controls and hairlines.

The primary task is to inspect and edit one type's nested structure, including
inherited members, choice arms, function signatures and interior type references.
The user explicitly chose nested DOM over XYFlow for this surface. Graph retains
its independent canvas. Structure's normal scrollable document uses natural
layout, stable text size and small nesting insets; expanded members sit beside
one another only when the current card has enough space. Type kind color is a
header/type-reference cue; inherited sections have a quieter dashed boundary.

Keep the canonical Structure adapter, instance-specific expansion state, recursion
guards, readonly policies, editor slots and metadata/diagnostic/navigation
implementations. Do not replace these with a second model or mutation system.
Real buttons make interior references keyboard reachable. Narrow cards wrap their
name and type controls without shrinking the text or clipping dropdowns.

This is an incumbent-system refinement, not a replacement visual world. Local
browser checks cover desktop, intermediate and 390px focused layouts, nested
inheritance, independent expansion, cardinality edits, context-menu focus return,
no horizontal overflow and scoped Axe accessibility.

Retain Graph's colored headers, matching card backgrounds and shared text tokens.
Keep individual member rows unboxed. Headers move blocks; the root moves freely
and interior blocks stay in the owning branch. A vertical divider at the child's
left edge changes only horizontal width, while the parent field fills the rest.
Use keyboard Left/Right on the separator, with no up/down resizing or corner grips.
Content determines height. Layout is local view state, retained through collapse
and cleared by Reset layout; it never writes source. The toolbar scrolls normally
so it cannot cover fields.

Navigation and keyboard-header focus highlight the interior canonical type card,
including derived cards inside an inheritance wrapper; the canvas has no focus
outline. Studio's shared Inspector/Preview section density comes from the two
design-system panel padding tokens, with nested content sharing the outer gutter.
