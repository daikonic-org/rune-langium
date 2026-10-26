---
version: 1
slug: "apps-studio-src-components-formpreviewpanel-tsx"
primary_target: "src/components/FormPreviewPanel.tsx"
related_targets: ["src/components/TemporalPreviewInput.tsx", "src/components/PreviewObjectGrid.tsx", "src/components/form-preview.css", "../../packages/design-system/src/ui/calendar.tsx"]
---

# Preview and Prototype forms

Mode: Operate. Extend the existing Studio surface; retain its established identity.
Scope: shared form renderer, temporal controls, choice/list/object presentation.
Task: author and inspect Rune sample values in a narrow Preview rail or a wide Prototype pane.

## Direction contract

THESIS: a compact record editor, with collections scanned as grids and complex values opened deliberately rather than an indefinitely indented form.

OWN-WORLD: inherit Studio's dark semantic surfaces, Inter UI labels, monospace data where useful, one-pixel hairlines, rounded controls and Lucide glyphs. Brand accents indicate actions, selection and validation.

STORY: choose the right variant, scan collection values, open one item, edit its complete structure and return to the same collection without losing context. Working default: edits remain live.

FIRST VIEWPORT: consistent field labels and controls; flat object sections; a dropdown for each choice; compact object rows with selected state, count and Add action. The up-right arrow opens full item details. Scalars remain directly editable.

FORM: user-specified extension of the existing workbench; no concept roll. seed: none (not applicable). Signature interaction is collection row to full details and back; motion uses existing popover/dialog transitions.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Constraints

Reuse authoritative preview schemas, finite recursive definitions, atomic choice updates and worker validation. Preserve ISO seconds, nanoseconds and zone/offset data. Match Preview and Prototype. Test narrow panes, object/list/choice nesting, keyboard access, empty/error states and no-data-loss editing. No global theme replacement or release work.

## Implemented contract and evidence

The shared renderer retains Studio's semantic palette, compact labels, existing
controls and hairlines. Choices use Select; object sections flatten their nested
spacing; object collections expose schema-derived summary columns, row selection,
an up-right detail action and an ellipsis menu for removal. Details reuse the same
field renderer and live edits, with breadcrumb navigation and focus returning to
the opening control. Ordinary schema labels stay unchanged; only actual list-item
paths ending in `[]` receive item ordinals. Boolean labels activate their checkbox.

Temporal popovers compose the shared design-system Calendar and themed time
segments over ISO values. Worker validation, schema definitions and atomic value
handlers remain authoritative; the controls retain fractional precision and
authored timezone suffixes rather than introducing separate validation semantics.

The five local [browser journeys](../../test/e2e/form-workbench.spec.ts) pass
for Preview at 1280, 700 and 390 px and Prototype at 1440 and 390 px, including
live instance-payload updates, label interaction, focus return and temporal
precision. Scoped Axe checks cover the detail dialog and calendar popover.
Sixteen [captured images](../review/form-preview/) show Preview details, calendars,
collection overviews and resting fields at each width, plus Prototype collection
and resting views. Narrow Preview captures exercise the existing dock layout;
this evidence does not establish a complete mobile redesign of the IDE.

This is an incumbent-system extension. No global `DESIGN.md` or design sidecar
existed at inspection, and this surface does not establish a replacement visual
system. The finish review owns the final disposition separately from these
implementation and evidence notes.
