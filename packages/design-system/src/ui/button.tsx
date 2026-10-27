// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cloneElementWithMergedClassName, cn } from '../utils';

const buttonVariants = cva(
  // T058 (014/FR-026) — focus-visible normalised to a single
  // 2px outline + 2px offset using --ring (token-driven). Was
  // `focus-visible:ring-[3px]` which diverged from Studio's
  // hand-rolled `outline: 2px solid` rules elsewhere; now every
  // surface (button, input, namespace explorer) shares the spec.
  //
  // Phase-4 style-override cleanup: cursor-pointer added to base;
  // transition-all replaced with a targeted property list so layout
  // props (width, height, padding) are not animated on every state
  // change. Hover-lift (transform translateY(-1px)) and active-settle
  // are pushed here from the studio override block so all consumers
  // share the affordance; the 1px lift is subtle enough to be a
  // universal improvement. Active also applies a slight press-scale
  // (0.98) as click feedback, on top of settling the hover lift.
  // [&:not(:disabled):hover] and active selectors use Tailwind
  // arbitrary-variant syntax.
  'inline-flex min-h-6 max-h-7 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium cursor-pointer ' +
    // cursor-pointer is unconditional above; restore the not-allowed cursor for
    // disabled / aria-disabled states (the disabled:/aria-disabled: variants have
    // higher specificity than the bare cursor-pointer, so they win for those
    // states — otherwise cursor-pointer would override the global
    // `:where(:disabled,[aria-disabled='true']){cursor:not-allowed}` baseline).
    'disabled:cursor-not-allowed aria-disabled:cursor-not-allowed ' +
    '[transition:transform_140ms_cubic-bezier(0.22,1,0.36,1),background-color_160ms_ease,border-color_160ms_ease,color_160ms_ease,box-shadow_160ms_ease,opacity_160ms_ease] ' +
    '[&:not(:disabled):hover]:-translate-y-px [&:not(:disabled):active]:translate-y-0 [&:not(:disabled):active]:scale-[0.98] ' +
    'disabled:pointer-events-none disabled:opacity-50 ' +
    "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 " +
    'outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring) ' +
    'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80',
        destructive:
          'bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60',
        outline:
          // Hover text uses accent-foreground (light on the dark accent
          // surface) — the previous primary-foreground token resolves to a
          // dark surface tone in this theme, making label ≈ background on
          // hover (buttons "disappeared"). Active adds a step past hover so
          // press is visually distinct.
          'border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground active:bg-accent/70 dark:bg-input/30 dark:border-input dark:hover:bg-input/50 dark:active:bg-input/70',
        // T054 (014/FR-023, R8) — was `bg-secondary text-secondary-foreground
        // hover:bg-secondary/80` (solid amber), which made empty-state
        // CTAs visually outrank the actual primary button. Now matches
        // landing's `.btn-secondary` + docs' `.VPButton.alt`: transparent
        // surface with a visible border.
        secondary: 'bg-transparent border border-input/70 hover:bg-muted active:bg-muted/70 text-foreground',
        // Same fix as `outline`: accent-foreground for readable hover text,
        // plus a distinct pressed step.
        ghost:
          'hover:bg-accent hover:text-accent-foreground active:bg-accent/70 dark:hover:bg-accent/50 dark:active:bg-accent/70',
        link: 'text-primary underline-offset-4 hover:underline',
        // Translucent frosted-glass treatment for chrome surfaces (toolbar /
        // header). Was the contextual `.glass-toolbar [data-slot=button]`
        // override in studio app.css; promoted to an explicit, opt-in variant.
        // The teal "active" toggle state is driven by `aria-pressed` (the
        // toggle buttons already set it), not by overloading the base variant.
        // Multi-layer glows live in `--glass-btn-shadow*` tokens (theme.css).
        // Base hover-lift / transition come from the shared CVA base above.
        glass:
          'border bg-(--glass-btn-bg) border-(--glass-btn-border) text-(--glass-btn-text) shadow-(--glass-btn-shadow) ' +
          '[backdrop-filter:var(--glass-blur-sm)] [-webkit-backdrop-filter:var(--glass-blur-sm)] ' +
          'hover:bg-(--glass-btn-bg-hover) hover:border-(--glass-btn-border-hover) hover:text-(--glass-btn-text-hover) hover:shadow-(--glass-btn-shadow-hover) ' +
          'aria-pressed:bg-(--glass-btn-bg-active) aria-pressed:border-(--glass-btn-border-active) aria-pressed:text-(--glass-btn-text-active) aria-pressed:shadow-(--glass-btn-shadow-active) ' +
          'aria-pressed:hover:bg-(--glass-btn-bg-active-hover) aria-pressed:hover:border-(--glass-btn-border-active-hover) aria-pressed:hover:text-(--glass-btn-text-active-hover) aria-pressed:hover:shadow-(--glass-btn-shadow-active-hover)'
      },
      size: {
        default: 'h-7 px-3 py-0 has-[>svg]:px-2.5',
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: 'h-7 rounded-md gap-1.5 px-2.5 has-[>svg]:px-2',
        lg: 'h-7 rounded-md px-4 has-[>svg]:px-3',
        icon: 'size-7',
        // Existing size names retain their width/icon intent; controls have
        // only two heights: compact 24px and standard 28px.
        'icon-xs': "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-7',
        'icon-lg': 'size-7'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  render,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    render?: React.ReactElement<{ className?: string }>;
  }) {
  const buttonProps = {
    'data-slot': 'button',
    'data-variant': variant,
    'data-size': size,
    className: cn(buttonVariants({ variant, size, className })),
    ...props
  };

  if (render != null && React.isValidElement(render)) {
    return cloneElementWithMergedClassName(render, buttonProps);
  }

  return <button {...buttonProps} />;
}

export { Button, buttonVariants };
