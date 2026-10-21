# design-sync notes — @rune-langium/design-system → claude.ai/design

Project: "Daikonic Studio Components" (`projectId` in config.json). Package shape (no Storybook).

## Build
- From the repo root, run `node .design-sync/build.mjs`. The wrapper derives the visual-editor prop contracts from current TypeScript source into ignored `.design-sync/.cache/config.json`, then invokes the staged converter. Its `buildCmd` builds design-system and compiles the Tailwind entry.
- Do not invoke the converter with the tracked `config.json`: it intentionally contains no handwritten `dtsPropsFor`. The generated config supplies those bodies before converter discovery.
- Validation:
  ```bash
  pnpm exec tsc --project .design-sync/tsconfig.json
  node --test .design-sync/prepare-config.test.mjs
  pnpm --filter @rune-langium/visual-editor exec vitest run --config ../../.design-sync/vitest.config.ts
  node .ds-sync/package-validate.mjs ./ds-bundle
  node .design-sync/verify-theme.mjs
  ```
  CI checks all authored previews, source/generated contract assignability in both directions, propagation of source API changes, and Command filtering/selection. Local bundle validation additionally renders the converter output in Chromium. `verify-theme.mjs` checks the active selector and compares seven computed colors (including the error accent) against the authoritative Studio stylesheet, then exercises Command filtering and selection.
- Converter deps live in `.ds-sync/` (npm, isolated): esbuild ts-morph @types/react `@tailwindcss/cli@4.3.3` `tailwindcss@4.3.3` tw-animate-css `playwright@1.63.0`.
  `.design-sync/node_modules` → `../.ds-sync/node_modules` symlink (gitignored, recreate per clone) so `@import 'tailwindcss'` in `.design-sync/tailwind.css` resolves.
- playwright 1.63.0 pins chromium-1243 (the locally cached build); the repo's own playwright-core 1.62.1 pins 1234.
- Package needed `"types": "./dist/ui/index.d.ts"` (converter reads `types` to find the .d.ts barrel; `exports` still wins for TS so workspace resolution is unchanged) and the `ui/index` barrel was missing number-chiclet + row-glyph.

## Styling
- Components are Tailwind v4 utility-class styled; the DS ships only source CSS (`theme.css` with `@theme inline`). `.design-sync/tailwind.css` uses Studio’s shared theme layers (tailwind → tw-animate-css → theme.css → dock-theme.css → visual-editor defaults → Studio daikonic.css) and `@source`s the DS src + `.design-sync/previews` → compiled `dist/ds-sync.css` = `cfg.cssEntry` (must live inside the package dir).
- `@import 'tailwindcss' source(none)` — the CLI otherwise auto-scans the whole repo (cwd) and ships Studio/docs-only classes (was the source of stray `bg-[var(--color-brand-500)]`, `bg-gray-500`, …).
- `@source inline(...)` safelist guarantees the design-agent vocabulary documented in `conventions.md` (layout/spacing/sizing/semantic-token colors). Keep the two in sync; the safelist color matrix is deliberately trimmed (full opacity×state cross product = +490KB).
- The palette overlay is imported from Studio's source-available `apps/studio/src/styles/daikonic.css`; retain its FSL-1.1-ALv2 attribution. Components remain the design-system/visual-editor presentational exports. Set `data-theme="daikonic"` on `<html>` alongside `dark`, including when consuming the generated bundle.
- Brand fonts (Inter / JetBrains Mono / Outfit) load via the same Google Fonts `@import url(...)` as `apps/studio/index.html:9`.
- Studio hardcodes `<html class="dark">`; the only shipped palette is dark Daikonic (midnight-green surfaces, sandy-brown primary, keppel-teal secondary). User (2026-09-29): light mode / alternative palettes are welcome but not built yet — do not invent one; keep designs token-driven.
- The Studio body profile in the authoritative `daikonic.css` overlay supplies 13 px Inter UI text, normal tracking and one-pixel semantic hairlines. `_studio-dark` sets `data-studio-app="true"` so design previews and portaled overlays match the application.
- Preview card shell forces `body{background:#fff}`; every authored preview imports `./_studio-dark` (side effect: `html.dark` + `data-theme="daikonic"` + body bg/fg tokens) so portaled overlays inherit the theme. The import is stripped from `.prompt.md` examples.

- Shared text fields use compact `h-6` / `text-xs` / `px-1.5` defaults, `rounded-md`
  corners and an inset focus ring. Input's `inline` variant leaves density to the
  caller while sharing the same fill, border and focus treatment. Textarea uses
  that chrome with vertical content space; larger form/search controls retain
  explicit height overrides. Keep focus inside the field so Inspector scroll
  boundaries do not clip it.

- `Disclosure` (native details) and `DisclosureButton` (caller-owned expansion)
  share a 28 px header, left-hand Lucide chevron, spacing, typography and inset
  keyboard focus. Use them for metadata/annotation details and form payloads;
  retain the caller's panel lifecycle and initial expanded state. Native markers
  are suppressed, and the chevron tracks the immediate details element's state.

## Previews
- Story source: the prod-ux journeys (`apps/studio/test/prod-ux/journeys/j01..j18`) — each preview composes the component the way Studio uses it in that flow (user directive). Port JSX from the Studio component that the journey exercises.
- 31 roots authored; 72 subparts (DialogContent, SelectItem, …) ship floor cards by design (shown composed inside their parent's card).
- Overlays use `cardMode: single` + viewport overrides.
- Calendar now has an authored [SettlementDate preview](previews/Calendar.tsx),
  composed from the shared [Calendar source](../packages/design-system/src/ui/calendar.tsx)
  used by Preview/Prototype temporal popovers. Its public props follow the pinned
  `react-day-picker@9.14.0` `DayPicker` API; keep v9 class-name slots and component
  overrides aligned with that source. It reuses Button variants and semantic
  theme tokens for navigation, selection, today and outside days, while DayPicker
  owns date-grid and keyboard semantics. The preview imports `_studio-dark` so
  its theme matches Studio and portaled temporal controls.

## Composition gotchas (from preview waves)
- base-ui, not Radix: `DropdownMenuLabel` must sit inside `DropdownMenuGroup` or the whole menu throws (blank card).
- `Heading` needs numeric `level` (1-4); `Avatar` needs `AvatarFallback` child; `RowGlyph` needs `variant`.
- `AlertDescription` is a CSS grid: wrap inline text + `<code>` in a `<p>` or each inline piece becomes a row.
- `Form` = react-hook-form `FormProvider` only (no FormField/FormItem) — compose `useForm` + `Controller` + `Field*`.
- `ToastViewport` is `fixed bottom-0`; previews pass `className="top-0 bottom-auto"`; toasts seeded via `useToastManager().add({timeout:0})` inside `ToastProvider`.
- `Command` uses Base UI Combobox: supply grouped `items` and `onItemSelect`; `CommandGroup` takes an `id` and a render-function child, and `CommandItem.value` is the entry object. Static cmdk children are incompatible.
- Never put `${...}` inside template-literal code samples in previews (ReferenceError at capture).
- Select stories use default `item-aligned`; `position="popper"` sets the list to `h-(--anchor-height)` (only ~1 row visible) — DS bug, unfixed, needs base-ui investigation.

## DS fixes made during this sync (2026-09-29)
- `CommandItem`: `data-disabled:` → `data-[disabled=true]:` (cmdk renders `data-disabled="false"` on every item, so all items were 50% opacity + pointer-events-none).
- `SelectItem` highlight: `text-primary-foreground` → `text-accent-foreground` (dark-on-dark contrast).

## Scope follow-ups
- The same project includes KindBadge, NodeKindBadge, GraphLegend, CardinalityPicker and TypeSelector through `extraEntries` plus visual-editor styles. Model-bound editor forms stay out of this presentational bundle. They consume Langium-generated Zod schemas and z2f's shared section renderer; Studio also uses `?z2f` for compile-time option forms. Additional standalone presentational exports remain a follow-up; Studio chrome only informs conventions.

## Known render warns
- `[RENDER_THIN]` Dialog / InteractiveDialog: 0px measured height because content portals to body with fixed positioning — screenshots verified rendering correctly (benign).
- Review/capture cells are a fixed ~670x520 frame; compact components (Separator, IconButtonGroup, AppSwitcher, Kbd) sit top-left in empty dark space — cosmetic.
- Disabled primary Button label is low-contrast on the dark surface (DS design choice, opacity 0.5) — not changed.
- `[TOKENS_MISSING]` ~15: `--type-chip-bg/-fg`, `--rune-chip-padding-*` (set inline by TypeChip/chip components) and `--rune-header-height` (set at runtime by visual-editor `layout/graph-node-geometry.ts`). Expected.
- `[DOCS_UNMAPPED]` for the 5 VE components — prompt.md synthesized from dtsPropsFor + JSDoc + previews. Expected.

## Re-sync risks
- The first sync (2026-09-29) used cmdk; the current Command preview uses the Base UI API and has filtering/selection regression tests. Re-run the preview checks before re-syncing.
- The five visual-editor prop bodies are generated by `prepare-config.mjs` using the component call signatures. Keep `componentSrcMap` pointed at their authoritative sources. Recursive contracts fail explicitly rather than emitting a placeholder; extend the generator and its contract checks if a new component needs that shape.
- Google Fonts URL duplicated from `apps/studio/index.html` — keep in sync.
- `.design-sync/tailwind.css` import order duplicates `apps/studio/src/app.css`'s DS layer — if Studio adds a DS-level stylesheet, add it here too.
- Utility classes only exist if DS src / VE components / previews / the safelist use them; arbitrary values (`w-[480px]`) only if already used. conventions.md tells the agent this — re-validate its class list against `_ds_bundle.css` on every sync.
- Grades are keyed on a contract that includes global config (adding VE dtsPropsFor/extraEntries cleared every DS grade once) — expect a one-time regrade when config shape changes.
