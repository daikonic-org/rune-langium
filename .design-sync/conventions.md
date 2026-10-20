# Daikonic (Rune Studio) — build conventions

**Setup.** Load `styles.css` and `_ds_bundle.js`; components live on `window.DaikonicDS`. Put `class="dark" data-theme="daikonic"` on `<html>` — Studio uses both, `dark:` variants and the Daikonic palette key off them, and dialogs/menus/toasts portal to `<body>`, so a wrapper `div` is not enough. Set `data-studio-app="true"` on `<body>` to apply Studio’s shared 13 px UI scale, normal tracking and one-pixel hairlines, including portaled overlays. The base layer already paints `body` with `bg-background text-foreground` in Inter (fonts load via `styles.css`). There is no provider component to wrap.

**Palette.** Dark Daikonic is the only shipped palette (midnight-green surfaces, sandy-brown `primary`, keppel-teal `secondary`, vermilion `destructive`). A light theme is planned but not built — never invent one, and never write raw hex/oklch: use the semantic tokens below so a future palette re-skins everything.

**Source attribution.** The component exports are MIT. The included Studio palette overlay (`apps/studio/src/styles/daikonic.css`) is source-available under FSL-1.1-ALv2, copyright (c) 2026 Pradeep Mouli.

**Styling idiom: Tailwind v4 utilities over semantic tokens.** Only classes compiled into `_ds_bundle.css` exist — stick to these families:

| Use | Classes |
|---|---|
| Surfaces | `bg-background` (app), `bg-card` (panels), `bg-popover`, `bg-muted`, `bg-accent` (hover/selected), `bg-sidebar`; opacity steps `/10 /20 /50 /80` |
| Text | `text-foreground`, `text-muted-foreground`, `text-primary`, `text-destructive`, `text-accent-foreground` |
| Lines | `border border-border`, `border-input`, `divide-y divide-border` |
| Rune kinds | Use `KindBadge` with its `kind` prop; it owns kind colors and readable background/foreground combinations. |
| Type | `font-sans` (default), `font-mono` (identifiers, namespaces, code), `font-display` (brand only); `text-3xs … text-4xl`; `font-medium/semibold` |
| Layout | `flex`, `grid grid-cols-{1..12}`, `gap-*`/`p-*`/`m-*` on the 0–24 scale, `w-/h-` scale + fractions, `max-w-{sm..7xl}`, `rounded-{sm,md,lg,xl}`, `shadow-{xs,sm,md}` |
| Chrome | `studio-card` (12px radius + hairline + shadow elevated surface) |

For a one-off size outside the scale, use `style={{ width: 480 }}` — arbitrary-value classes like `w-[480px]` render unstyled unless the DS already uses them.

**Studio typography.** Inter for UI labels and navigation, 13 px / 1.5 by default
with normal tracking; 12 px for supporting text and 16 px semibold for section
headings. Keep source/code in JetBrains Mono and the brand wordmark in Outfit.
Use rem-based tokens and preserve user text scaling. Dividers use `--border`,
inputs use the stronger `--input`, and widths use `--hairline` throughout.
Dock headers and the center selector share `--studio-panel-header-height`
(2.3125rem); allow the selector to grow when its controls wrap. Keep the Explorer
availability count in its bottom footer, separate from search and breadcrumbs.

**Studio patterns (copy these).**
- Panel section label: `text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground`.
- Identifiers (`cdm.base.datetime`, `tradeDate`, `(0..*)`) are `font-mono text-xs`.
- Confirm/cancel flows use `InteractiveDialog` (`title`, `width="w-[480px]"`, `footer` of `Button variant="secondary" size="sm"` + `Button size="sm"`); forms use `FieldSet/FieldGroup/Field/FieldLabel/FieldDescription/FieldError` around `Input`/`Textarea`/`Checkbox`.
- Buttons: `default` = the one primary action; `secondary` = cancel/alternate; `ghost`/`outline` in toolbars; `glass` + `aria-pressed` for header view toggles; `size="sm"` in dialogs, `icon-sm` in panel toolbars.
- Type kinds render with `KindBadge kind="data|choice|enum|func"` (`shape="glyph"` in dense trees), never hand-colored spans. Cardinality uses `CardinalityPicker`, type fields `TypeSelector`.
- base-ui (not Radix) semantics: open state via `open`/`defaultOpen`; `DropdownMenuLabel` must sit inside `DropdownMenuGroup`; `Heading` needs numeric `level`; `Avatar` needs `AvatarFallback`.

**Where the truth lives.** `styles.css` → `_ds_bundle.css` (compiled utilities + `:root` tokens: `--background`, `--primary`, `--color-data`, `--font-mono`, …). Per-component API and examples: `components/<group>/<Name>/<Name>.prompt.md` and `.d.ts`.

```jsx
const { InteractiveDialog, Button, KindBadge } = window.DaikonicDS;
<InteractiveDialog open onOpenChange={() => {}} title="Generate TypeScript" description="Choose namespaces"
  width="w-[480px]" testId="gen" bodyClassName="p-4 gap-5"
  footer={<><Button variant="secondary" size="sm">Cancel</Button><Button size="sm">Generate</Button></>}>
  <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Namespaces</span>
  <div className="flex items-center gap-2 font-mono text-xs text-foreground">
    <KindBadge kind="data" shape="glyph" /> cdm.base.datetime
  </div>
</InteractiveDialog>
```
