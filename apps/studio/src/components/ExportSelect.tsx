// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { withInstrumentation } from '../services/instrumentation/core.js';
import type { ComponentProps } from 'react';
import { ChevronDown } from 'lucide-react';

/** Native selection keeps platform keyboard behavior; one inset glyph owns its geometry. */
export const ExportSelect = withInstrumentation(
  function ExportSelect({ children, ...props }: ComponentProps<'select'>) {
    return (
      <span data-slot="export-select" className="relative block min-w-0">
        <select
          {...props}
          className="h-8 w-full min-w-0 appearance-none rounded border border-input bg-background pl-3 pr-8 text-sm font-normal forced-colors:appearance-auto"
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground forced-colors:hidden"
        />
      </span>
    );
  },
  { op: 'ExportSelect' }
);
