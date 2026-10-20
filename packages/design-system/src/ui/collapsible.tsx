// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Collapsible — shadcn/ui Collapsible wrapping @base-ui/react/collapsible.
 *
 * @module
 */

import { Collapsible as CollapsiblePrimitive } from '@base-ui/react/collapsible';
import { ChevronRight } from 'lucide-react';
import { cn } from '../utils';

function Collapsible({ ...props }: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

function CollapsibleTrigger({ ...props }: React.ComponentProps<typeof CollapsiblePrimitive.Trigger>) {
  return <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...props} />;
}

function CollapsibleContent({ ...props }: React.ComponentProps<typeof CollapsiblePrimitive.Panel>) {
  return <CollapsiblePrimitive.Panel data-slot="collapsible-content" {...props} />;
}

const disclosureHeadingClassName =
  'flex min-h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-1 py-1 text-left text-xs font-medium text-foreground transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:opacity-50';
const disclosureIconClassName = 'size-3.5 shrink-0 transition-transform motion-reduce:transition-none';

/** Controlled disclosure heading; the caller retains panel and draft ownership. */
function DisclosureButton({ className, children, ...props }: React.ComponentProps<'button'>) {
  return (
    <button
      type="button"
      data-slot="disclosure-trigger"
      className={cn(disclosureHeadingClassName, '[&[aria-expanded=true]>svg]:rotate-90', className)}
      {...props}
    >
      <ChevronRight className={disclosureIconClassName} aria-hidden="true" />
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  );
}

/** Native disclosure with Studio's shared header chrome and browser-owned state. */
function Disclosure({
  label,
  className,
  children,
  ...props
}: React.ComponentProps<'details'> & { label: React.ReactNode }) {
  return (
    <details data-slot="disclosure" className={cn('min-w-0', className)} {...props}>
      <summary
        data-slot="disclosure-trigger"
        className={cn(
          disclosureHeadingClassName,
          'list-none [&::-webkit-details-marker]:hidden [[open]>&>svg]:rotate-90'
        )}
      >
        <ChevronRight className={disclosureIconClassName} aria-hidden="true" />
        <span className="min-w-0 flex-1">{label}</span>
      </summary>
      {children}
    </details>
  );
}

export { Collapsible, CollapsibleContent, CollapsibleTrigger, Disclosure, DisclosureButton };
