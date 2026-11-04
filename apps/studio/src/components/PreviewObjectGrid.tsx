// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { withInstrumentation } from '../services/instrumentation/core.js';
import type { ReactNode } from 'react';
import { ArrowUpRight, Ellipsis, Trash2, AlertCircle } from 'lucide-react';
import { Button } from '@rune-langium/design-system/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@rune-langium/design-system/ui/dropdown-menu';

export interface PreviewGridColumn {
  path: string;
  label: string;
  editable?: boolean;
}
export interface PreviewGridRow {
  path: string;
  label: string;
  cells: Array<{ path: string; text: string; empty: boolean; error?: string; editor?: ReactNode }>;
  issues: number;
}

/** Presentation only: the preview renderer supplies schema-derived cells and actions. */
export const PreviewObjectGrid = withInstrumentation(
  function PreviewObjectGrid({
    label,
    columns,
    rows,
    selectedIndex,
    onSelect,
    onOpen,
    onRemove
  }: {
    label: string;
    columns: PreviewGridColumn[];
    rows: PreviewGridRow[];
    selectedIndex: number | null;
    onSelect(index: number): void;
    onOpen(index: number, origin: HTMLElement): void;
    onRemove(index: number): void;
  }) {
    return (
      <div className="preview-object-grid studio-scroll">
        <table aria-label={label}>
          <thead>
            <tr>
              {columns.map((column, columnIndex) => (
                <th
                  scope="col"
                  key={column.path}
                  data-summary-column={columnIndex}
                  data-editable={column.editable ? 'true' : undefined}
                >
                  {column.label}
                </th>
              ))}
              <th scope="col" className="preview-object-grid__actions">
                <span className="sr-only">Item actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={row.path}
                aria-label={row.label}
                data-field-path={row.path}
                tabIndex={-1}
                data-selected={selectedIndex === index ? 'true' : undefined}
                onClick={() => onSelect(index)}
                onFocusCapture={() => onSelect(index)}
              >
                {row.cells.map((cell, columnIndex) => (
                  <td
                    key={cell.path}
                    data-summary-column={columnIndex}
                    data-editable={cell.editor ? 'true' : undefined}
                    data-field-path={cell.path}
                    tabIndex={-1}
                    title={cell.error ?? cell.text}
                    data-empty={cell.empty ? 'true' : undefined}
                    data-invalid={cell.error ? 'true' : undefined}
                  >
                    {cell.editor ?? <span className="block truncate">{cell.text}</span>}
                  </td>
                ))}
                <td className="preview-object-grid__actions">
                  <div className="flex items-center justify-end gap-1">
                    {row.issues > 0 && (
                      <AlertCircle
                        className="size-3.5 shrink-0 text-destructive"
                        aria-label={`${row.label}: ${row.issues} validation issues`}
                      />
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Open ${row.label} details`}
                      title={`Open ${row.label} details`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpen(index, event.currentTarget);
                      }}
                    >
                      <ArrowUpRight className="size-3.5" aria-hidden="true" />
                    </Button>
                    <DropdownMenu modal={false}>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Actions for ${row.label}`}
                          />
                        }
                      >
                        <Ellipsis className="size-3.5" aria-hidden="true" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem variant="destructive" onClick={() => onRemove(index)}>
                          <Trash2 className="size-3.5" aria-hidden="true" />
                          Remove item
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="preview-object-grid__empty">No items yet. Add an item to edit its details.</p>
        )}
      </div>
    );
  },
  { op: 'PreviewObjectGrid' }
);
