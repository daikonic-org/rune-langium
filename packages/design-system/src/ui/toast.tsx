// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import * as React from 'react';
import { Toast as ToastPrimitive } from '@base-ui/react/toast';
import { X } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../utils';

// Re-export for consumers (e.g. StudioToastProvider) that must not import Base UI directly.
export const useToastManager = ToastPrimitive.useToastManager;

function ToastProvider({
  duration,
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Provider> & {
  /** Compat alias for Base UI's `timeout` prop. */
  duration?: number;
}) {
  return <ToastPrimitive.Provider data-slot="toast-provider" timeout={duration} {...props} />;
}

function ToastViewport({ className, ...props }: React.ComponentProps<typeof ToastPrimitive.Viewport>) {
  return (
    <ToastPrimitive.Viewport
      data-slot="toast-viewport"
      className={cn(
        'pointer-events-none fixed right-0 bottom-0 z-[70] flex max-h-screen w-full flex-col-reverse gap-2 p-4 sm:max-w-[420px]',
        className
      )}
      {...props}
    />
  );
}

const toastVariants = cva(
  'group pointer-events-auto relative flex w-full items-start justify-between gap-3 overflow-hidden rounded-xl border p-4 pr-6 shadow-lg transition-[opacity,transform] data-[starting-style]:animate-in data-[ending-style]:animate-out data-[ending-style]:fade-out-80 data-[starting-style]:fade-in-0 data-[ending-style]:slide-out-to-right-full data-[starting-style]:slide-in-from-bottom-full',
  {
    variants: {
      variant: {
        default: 'border-border bg-background text-foreground',
        destructive: 'border-destructive/30 bg-destructive/10 text-destructive',
        loading: 'border-border bg-background text-foreground'
      }
    },
    defaultVariants: {
      variant: 'default'
    }
  }
);

function Toast({
  className,
  variant,
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Root> & VariantProps<typeof toastVariants>) {
  return (
    <ToastPrimitive.Root
      data-slot="toast"
      data-variant={variant}
      className={cn('group', toastVariants({ variant }), className)}
      {...props}
    />
  );
}

function ToastTitle({ className, ...props }: React.ComponentProps<typeof ToastPrimitive.Title>) {
  return (
    <ToastPrimitive.Title
      data-slot="toast-title"
      className={cn(
        'text-sm font-semibold',
        // Destructive title: text-sm (14px) semi-bold does NOT qualify as large
        // text under WCAG (needs ≥18.67px at 700+ weight), so the 4.5:1 threshold
        // applies. text-destructive (#f03630) on the dark toast bg is ~4.13:1 —
        // just below AA. Override to near-white using the group-data variant keyed
        // on data-variant (which we control) so the fix is reliable regardless of
        // what attributes Base UI propagates to child slots.
        'group-data-[variant=destructive]:text-foreground/90',
        className
      )}
      {...props}
    />
  );
}

function ToastDescription({ className, ...props }: React.ComponentProps<typeof ToastPrimitive.Description>) {
  return (
    <ToastPrimitive.Description
      data-slot="toast-description"
      className={cn(
        'text-sm leading-relaxed',
        // Same contrast problem as the title — normal-weight 14px needs 4.5:1.
        // Use group-data-[variant=destructive] (keyed on data-variant which we
        // set on the root) so this works regardless of what Base UI propagates.
        'group-data-[variant=destructive]:text-foreground/75',
        className
      )}
      {...props}
    />
  );
}

function ToastClose({ className, children, ...props }: React.ComponentProps<typeof ToastPrimitive.Close>) {
  return (
    <ToastPrimitive.Close
      data-slot="toast-close"
      className={cn(
        'absolute top-2 right-2 inline-flex size-7 items-center justify-center rounded-md text-current/70 transition-colors hover:bg-black/5 hover:text-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring) dark:hover:bg-white/10',
        className
      )}
      {...props}
    >
      {children ?? <X className="size-4" />}
    </ToastPrimitive.Close>
  );
}

export { Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport, toastVariants };
