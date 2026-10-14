// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { KeyboardEvent } from 'react';

/** Shared geometry for editable Inspector member names and their row hit areas. */
export const INSPECTOR_ROW_NAME_CLASS = 'min-w-0 px-2 py-1 text-sm';
export const INSPECTOR_ROW_CLASS = 'rune-inspector-row border border-transparent px-1 py-1 hover:border-border';

export interface InspectorRowProps {
  selected?: boolean;
  onSelect?: () => void;
}

/** Select on focus/click without intercepting keys owned by row inputs or pickers. */
export function inspectorRowAttributes({ selected, onSelect }: InspectorRowProps, name: string) {
  return {
    'data-selected': selected || undefined,
    tabIndex: onSelect ? 0 : undefined,
    'aria-label': onSelect ? `Inspect ${name}` : undefined,
    onFocusCapture: onSelect,
    onClick: onSelect,
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.currentTarget === event.target && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        onSelect?.();
      }
    }
  };
}
