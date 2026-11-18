# @rune-langium/design-system

Shared design tokens, theme, and UI primitives for Rune DSL tooling. Built with [Base UI](https://base-ui.com/), [Tailwind CSS 4](https://tailwindcss.com/), and [class-variance-authority](https://cva.style/).

## Components

- Badge, Button, Collapsible, Command palette, Field, Form, Input, Label, ListCard, NativeSelect, Popover, Resizable panels, Scroll area, Select, Separator, Spinner, Tabs, Textarea, Tooltip

## Usage

`ListCard` supplies the shared icon/title/subtitle layout inside host-owned list
buttons and tree rows. `compact` keeps a one-line subtitle; `detailed` permits a
three-line description and a status/detail line. Detail changes information depth,
not outer padding. Hosts retain navigation, drag, selection and focus semantics.
Virtualized hosts must reserve the subtitle's row height, and content-sized trees
must stay bounded for large inventories.
Wrapped controls should derive their names from visible card content. For a
title-only control, pass it as `name` and associate `descriptionId` with the
control's `aria-describedby`, keeping the subtitle outside the control.

```typescript
import { Button } from '@rune-langium/design-system/ui/button';
import { Badge } from '@rune-langium/design-system/ui/badge';
import { NativeSelect } from '@rune-langium/design-system/ui/select';
```

```css
@import '@rune-langium/design-system/theme.css';
```

## Typography

`src/tokens.css` owns four font-family tokens, also exposed as matching Tailwind
utilities and TypeScript CSS-variable references:

| Token | Family | Use |
| --- | --- | --- |
| `--font-title` | Transit Sans | Titles and wordmark |
| `--font-body` | Transit System | UI, tabs and internal labels |
| `--font-mono` | JetBrains Mono | Other monospace content |
| `--font-code` | Transit Code | CodeMirror editors |

Family stacks exist only in this CSS token layer; consumers reference tokens.
`src/tokens.css` imports the shared variable webfonts. `src/fonts/manifest.json` pins the
upstream release, axes and SHA-256 of each unmodified WOFF2; that directory retains
the upstream OFL and notices. The combined site build copies this same source for
the static landing page. Vite fingerprints font assets for Studio and docs.

The ambient UI uses Transit System Book 350 (`--font-weight-book`).
Action buttons and the Studio center-pane toggles use Medium 500; primary and
destructive action buttons use SemiBold 600. Field labels and disclosures remain
Regular 400 (`font-normal`, bridged to `--font-weight-regular` by the theme).
Use `.navigation-tab` for tabs and view toggles: System Regular 400 in authored
case. The shared tabs primitive uses this role by default.
Use `.navigation-heading` for perspective names and panel titles, and
`.section-heading` for internal section labels: System Regular 400 in authored case.
Panel/perspective titles retain Sans Regular 400.
Add `.perspective-heading` only to perspective names for uppercase and
`--perspective-heading-letter-spacing` (0.10em). Apply heading roles to text spans
when a header also contains controls or counts.

Studio reduces the UI text scale by exactly 1px through its body profile, including
portaled overlays. The primitive `--font-size-*` scale remains unchanged; Sans
heading roles retain that unscaled size. Tabs use the reduced UI scale. Studio
also reduces monospace text by 1px through its separate
`--studio-mono-font-reduction` setting; the shared CodeMirror text/gutter style
uses that same setting. Font-face scaling, the root rem size and control geometry are unchanged.
The Studio wordmark is uppercase Sans SemiBold 600 with the shared 0.10em perspective tracking. Inspector detail-pane titles
use the smaller Sans Medium 500 treatment at 13px.

## Panel and section spacing

`src/tokens.css` owns the shared density defaults: `--panel-padding-inline`
(12px) and `--panel-padding-block` (8px). Theme-level overrides of these two
properties update every consuming section together.

Use `px-panel-x py-panel-y` for panel sections. Use `py-panel-y` for nested
sections whose parent already owns the horizontal gutter. Shared Inspector
frames, Preview and Prototype use these semantic utilities instead of individual
numeric padding classes; keep new sections on the same defaults.

Compact Inspector forms use `--inspector-padding-inline` (8px) for one shared
outer gutter. `--field-label-gap` (4px) controls label-to-input spacing in Field
and Preview, including object detail forms.

## Control families

The design system owns field appearance; zod-to-form owns schema-driven field
construction, registration and validation. Studio's generated-form adapter
re-exports these controls and visual-editor's shared `FieldTemplate`; it does not
maintain another set of field components.

| Intent | Component | Contract |
| --- | --- | --- |
| Single-line text or number | `Input` | One compact treatment; use layout classes for width, not a separate inline variant. |
| Search field | `SearchInput` | Composes Input and one decorative search icon; refs and ARIA remain on the input. |
| Multiline text | `Textarea` | Same field chrome, content-sized height with caller-owned bounds. |
| Ordinary option list | `NativeSelect` | Native options, change events, form registration and keyboard behavior. |
| Rich popup options | `Select` | Base UI selection, focus and popup behavior; retain controlled z2f bindings. |
| Searchable domain choices | `Command` and `Popover` composition | Type and large code-list pickers retain search and domain metadata. |
| Domain picker | `PickerTrigger`, `PickerOption` | Shared field trigger and native option/navigation rows; the composing picker owns semantics and validation. |
| Boolean or exclusive choice | `Checkbox`, `RadioGroup` | Preserve their native accessible roles and label relationships. |
| Action or toggle action | `Button` | Existing variants; `ghost` exposes `aria-pressed` and `data-active` state. |

`Input`, `Textarea`, `NativeSelect` and `PickerTrigger` share one private field
chrome definition, including invalid, disabled and keyboard-focus states.
`SelectTrigger` renders PickerTrigger, and CommandInput renders SearchInput.
SelectItem, CommandItem and PickerOption share option-row spacing and state
treatments. Custom Base UI render elements retain the shared trigger variants.
Single-line fields default to 24px; standard selectors and actions use 28px.
`FieldGroup` uses 8px row gaps, with 12px between nested groups/sets. Native
selects restore platform arrows in forced-colors mode.
Horizontal Field rows use an 8px control-to-label gap; vertical fields retain
the 4px label-to-control gap. Descriptions align with their label column.

Tabs, tree navigation, graph handles and multiline diagnostic rows retain their
specific interaction and geometry. Cardinality presets and namespace picker
leaves reuse PickerOption; virtualized row heights, Rune validation and type-kind
chips remain domain concerns. Do not replace these with an action button merely
to reduce a component count.

## License

MIT

Typography lint in Studio and visual-editor requires these four family tokens and
weight tokens. It rejects raw stacks, old aliases and font shorthand; existing
geometry lint covers raw font sizes. Font-face registrations and token definitions
remain the authoritative literal-value exceptions. The typography rule also checks
the shared design-system stylesheets in the visual-editor unit suite.
