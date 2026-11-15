// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import * as React from 'react';
import { Progress as ProgressPrimitive } from '@base-ui/react/progress';
import { cn } from '../utils';

/** Task progress in native units; use null while the amount of work is unknown. */
function Progress({ className, ...props }: Omit<React.ComponentProps<typeof ProgressPrimitive.Root>, 'children'>) {
  return (
    <ProgressPrimitive.Root data-slot="progress" className={cn('h-1.5 w-full', className)} {...props}>
      <ProgressPrimitive.Track data-slot="progress-track" className="h-full overflow-hidden rounded-full bg-muted">
        <ProgressPrimitive.Indicator
          data-slot="progress-indicator"
          className="h-full rounded-full bg-primary transition-[width] duration-200 data-[indeterminate]:w-1/3 data-[indeterminate]:animate-pulse motion-reduce:animate-none motion-reduce:transition-none"
        />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  );
}

export { Progress };
