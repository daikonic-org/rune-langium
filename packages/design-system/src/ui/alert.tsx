// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Alert — shadcn/ui Alert primitive.
 *
 * Standardises the inline status/error banner pattern that was hand-rolled
 * across App, EditorPage, GitHubWorkspaceFlow, DockShell, and elsewhere.
 *
 * Variants: `default` (subtle muted), `destructive` (errors), `warning`
 * (amber). All variants use the Daikonic theme tokens — no hard-coded
 * colors here; theme.css decides what destructive/warning look like.
 */

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cloneElementWithMergedClassName, cn } from '../utils';

const alertVariants = cva(
  'relative w-full rounded-md border px-3 py-2 text-sm grid grid-cols-[0_1fr] has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-[>svg]:gap-x-3 gap-y-0.5 items-start [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current',
  {
    variants: {
      variant: {
        default: 'bg-card text-card-foreground border-border',
        destructive: 'bg-destructive/10 border-destructive/30 text-destructive [&>svg]:text-destructive',
        warning: 'bg-warning/10 border-warning/30 text-warning [&>svg]:text-warning'
      }
    },
    defaultVariants: { variant: 'default' }
  }
);

function Alert({ className, variant, ...props }: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return <div data-slot="alert" role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

function AlertTitle({
  className,
  render,
  ...props
}: React.ComponentProps<'div'> & { render?: React.ReactElement<{ className?: string }> }) {
  const alertTitleProps = {
    'data-slot': 'alert-title',
    className: cn('col-start-2 line-clamp-1 min-h-4 font-normal', className),
    ...props
  };
  if (render != null && React.isValidElement(render)) {
    return cloneElementWithMergedClassName(render, alertTitleProps);
  }
  return <div {...alertTitleProps} />;
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn('col-start-2 grid justify-items-start gap-1 text-sm [&_p]:leading-relaxed opacity-90', className)}
      {...props}
    />
  );
}

export { Alert, AlertDescription, AlertTitle, alertVariants };
