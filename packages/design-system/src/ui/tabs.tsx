// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Tabs — shadcn/ui Tabs wrapping @base-ui/react/tabs.
 *
 * @module
 */

import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';

import { cn } from '../utils';

function Tabs({ ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" {...props} />;
}

/**
 * TabsList size variants:
 *   default — standard pill strip (bg-muted, rounded, p-1 gap-1)
 *   sm      — compact underline strip for dense panels. Sets
 *             `data-size="sm"` on the list element so the consuming
 *             app can target `[data-slot='tabs-list'][data-size='sm']`
 *             and its descendant triggers via CSS. Height 34px,
 *             bottom border hairline, no pill background.
 *             Use in inspector-style tabbed subsections (e.g. DataTypeForm).
 */
type TabsListSize = 'default' | 'sm';

function TabsList({
  className,
  size = 'default',
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & { size?: TabsListSize }) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-size={size}
      className={cn(
        size === 'default' && 'flex items-center gap-1 rounded-lg bg-muted p-1',
        size === 'sm' && 'flex items-center gap-0.5 h-[34px] bg-transparent rounded-none p-0',
        className
      )}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Tab>) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        'navigation-tab rounded-md px-3 py-1.5 text-sm',
        'data-[active]:bg-background data-[active]:text-foreground data-[active]:shadow-sm',
        className
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Panel>) {
  return <TabsPrimitive.Panel data-slot="tabs-content" className={cn('mt-2', className)} {...props} />;
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
export type { TabsListSize };
