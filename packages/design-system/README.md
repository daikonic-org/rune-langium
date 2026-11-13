# @rune-langium/design-system

Shared design tokens, theme, and UI primitives for Rune DSL tooling. Built with [Base UI](https://base-ui.com/), [Tailwind CSS 4](https://tailwindcss.com/), and [class-variance-authority](https://cva.style/).

## Components

- Badge, Button, Collapsible, Command palette, Field, Form, Input, Label, NativeSelect, Popover, Resizable panels, Scroll area, Select, Separator, Spinner, Tabs, Textarea, Tooltip

## Usage

```typescript
import { Button } from '@rune-langium/design-system/ui/button';
import { Badge } from '@rune-langium/design-system/ui/badge';
import { NativeSelect } from '@rune-langium/design-system/ui/select';
```

```css
@import '@rune-langium/design-system/theme.css';
```

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
