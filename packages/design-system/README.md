# @rune-langium/design-system

Shared design tokens, theme, and UI primitives for Rune DSL tooling. Built with [Radix UI](https://www.radix-ui.com/), [Tailwind CSS 4](https://tailwindcss.com/), and [class-variance-authority](https://cva.style/).

## Components

- Badge, Button, Collapsible, Command palette, Field, Form, Input, Label, Popover, Resizable panels, Scroll area, Select, Separator, Spinner, Tabs, Textarea, Tooltip

## Usage

```typescript
import { Button } from '@rune-langium/design-system/ui/button';
import { Badge } from '@rune-langium/design-system/ui/badge';
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

## License

MIT
