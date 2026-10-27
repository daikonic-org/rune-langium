// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { withInstrumentation } from '../services/instrumentation/core.js';
import type { ComponentProps } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@rune-langium/design-system/utils';

/** Native selection keeps platform keyboard behavior; one inset glyph owns its geometry. */
export const ExportSelect = withInstrumentation(
  function ExportSelect({ children, className, ...props }: ComponentProps<'select'>) {
    return (
      <span data-slot="export-select" className="relative block min-w-0">
        <select
          {...props}
          data-slot="native-select"
          data-size="sm"
          className={cn(
            'h-6 w-full min-w-0 appearance-none rounded-md border border-input bg-background pl-1.5 pr-6 py-0 text-xs font-normal forced-colors:appearance-auto',
            className
          )}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute right-1.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground forced-colors:hidden"
        />
      </span>
    );
  },
  { op: 'ExportSelect' }
);
