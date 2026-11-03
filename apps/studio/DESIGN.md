# Rune Studio design

Studio is a source-available, compact workbench (Operate mode). The light theme
adapts VectorMark's **Jury Room** vocabulary: petrol ink and framing, ice workspace,
white working cards, restrained mint actions and lilac keyboard focus. This is a
Studio direction, recorded here independently of that reference checkout.

Use `@rune-langium/design-system/theme.css`. Its `light-theme.css` palette is the
single light color authority, activated by `html[data-theme='light']`. Components
consume semantic tokens; do not add parallel palettes to individual perspectives.
Body portals inherit the same palette as Explorer, Graph, Structure, Source,
Inspector, generated views, Prototype and launcher. Settings → Appearance stores
this personal preference under the existing `rune-studio:theme` key. The `theme`
URL parameter retains precedence on startup. Daikonic and Refactory dark remain
available; no system preference silently replaces an explicit choice.

## Studio adaptation

- Preserve Inter UI, Outfit wordmark and JetBrains Mono code, plus existing compact
  sizing. Public Sans inspired the reference's practical voice, but changing
  Studio's font or density would break its existing identity.
- Ice `#eaf1f0` surrounds white cards. Petrol `#123f46` identifies primary actions;
  mint `#d7f5a9` is secondary action fill with dark green text. Avoid broad lilac
  washes: `#7160b5` is the focus cue.
- Type identity stays teal Data, ochre Choice, purple Enum and blue Function.
  Their darker light-mode inks share one family across badges, pickers, explorer,
  cards and syntax. Tint backgrounds from the same authoritative kind tokens.
- Text and placeholder ink is petrol, muted text `#526b70`; danger `#a52735` is
  reserved for validation and failure. Native fields and scrollbars use the light
  color scheme. Disabled controls retain the shared opacity/cursor convention.
- Light canvas is flat ice; borders and small offset shadows separate cards and
  floating menus. Dark shadows and the existing dark canvas remain unchanged.
- Preserve the shared SVG radish without rasterization or recoloring its artwork.
  Keep code token classification and annotation/comment semantics independent
  of theme colors. All code editors inherit the shared syntax token values.

## Workbench density and frame

- Single-line controls use two heights: compact 24px and standard 28px. The
  shared Button, Input and Select primitives own sizing; Studio must not override
  these with additional global minimum heights. Existing button size names keep
  their width and icon intent. Textareas, list rows, touch affordances and dock
  resize targets have their own geometry.
- Multiline diagnostic actions grow with their text. Wrap long field paths and
  keep the icon aligned with the first line; never cap a diagnostic row to a
  single-line control height. Validation disclosures stay inside the viewport
  and scroll without hiding the recovery action.
- Settings uses a common label column. Adjacent field/action pairs share the
  compact height; validation messages sit below their control, including boolean
  fields, without moving the label away from the checkbox.
- Inspector member names retain readable space beside type references. Long type
  chips truncate relative to the row width; full member names remain available in
  tooltips. Expression Text dialogs use the shared content-sized code surface,
  with a four-line minimum and a bounded scrollable maximum.
- The launcher fills its available frame. Recent Workspaces sits beside Starters
  on desktop and scrolls independently; navigation and workspace actions stay
  visible. Reference Models uses the same full-width, full-height frame. Narrow
  layouts keep the stacked flow. In a narrow recent-workspace column, metadata
  moves beneath the name before it can crowd out workspace identity.
- Generated Code offers a reversible target-list disclosure that retains the
  editor, file and target selection. The Git empty state links directly to
  Workspaces without starting authorization. Import options explain their effect
  on the Rune model through the authoritative schema metadata.
- Enabled inactive dock tabs use muted text tokens, not translucent foreground
  text. Light generated-code surfaces use the white working-card token so syntax
  colors retain their intended contrast.
- The Preview panel yields automatically when the current center panes need
  reading space, including larger text. Auto-collapse is reversible and does not
  remove its editors; explicit show/hide choices take precedence. Source and
  Inspector can be focused and restored without replacing peer drafts; Code can
  use native maximize/restore. Automatic size changes do not replace saved layouts.
- Validation leads with a short field/condition label, retaining full paths and
  canonical union alternatives in disclosures. A failed union stays one issue;
  presentation must not invent a validator or suppress a genuine failure.
- Studio help is available from the activity rail without leaving the active task.
  Import guidance is inline; errors retain parser locations, scroll into view and
  explain how to retry. The graph legend is a keyboard-accessible disclosure.
  Explorer placeholders and kind counts use full muted ink, with no extra alpha.
  Compact kind glyphs use foreground ink; their colored fill and border retain
  type identity without weakening the contrast of a tiny letter.
- Splitters stay invisible at rest and highlight the full 4px gap on hover or
  drag. Keep the existing transparent 16px drag target without a shadow outline.

## Review

Check desktop and 390px launcher/workbench, actual keyboard focus, dialogs and
menus, code/validation colors, persisted preference and both dark transitions.
Use the light-theme browser journey for repeatable captures and contrast evidence.
Existing local tests do not establish deployed service or physical-device coverage.
