// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { withInstrumentation } from '../services/instrumentation/core.js';
import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ArrowUpRight, ChevronRight, Ellipsis, Trash2, AlertCircle } from 'lucide-react';
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
  compact?: boolean;
  numeric?: boolean;
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
    expandedIndex,
    renderExpandedRow,
    onToggleExpanded,
    onSelect,
    onOpen,
    onRemove
  }: {
    label: string;
    columns: PreviewGridColumn[];
    rows: PreviewGridRow[];
    selectedIndex: number | null;
    expandedIndex: number | null;
    renderExpandedRow(index: number): ReactNode;
    onToggleExpanded(index: number): void;
    onSelect(index: number): void;
    onOpen(index: number, origin: HTMLElement): void;
    onRemove?(index: number): void;
  }) {
    const detailId = useId();
    const readOnly = !onRemove;
    const scrollHintId = `${detailId}-scroll`;
    const viewportRef = useRef<HTMLDivElement>(null);
    const tableRef = useRef<HTMLTableElement>(null);
    const [overflows, setOverflows] = useState(false);

    useEffect(() => {
      const viewport = viewportRef.current;
      const table = tableRef.current;
      if (!readOnly || !viewport || !table) return;
      const update = () => setOverflows(viewport.scrollWidth > viewport.clientWidth + 1);
      const observer = new ResizeObserver(update);
      observer.observe(viewport);
      observer.observe(table);
      return () => observer.disconnect();
    }, [readOnly]);

    const showScrollHint = readOnly && overflows;
    return (
      <>
        {showScrollHint && (
          <p id={scrollHintId} className="px-1.5 pb-1 text-xs text-caption">
            Scroll horizontally for more columns.
          </p>
        )}
        <div
          ref={viewportRef}
          className="preview-object-grid studio-scroll"
          data-read-only={readOnly || undefined}
          role={readOnly ? 'region' : undefined}
          aria-label={readOnly ? `${label} grid` : undefined}
          aria-describedby={showScrollHint ? scrollHintId : undefined}
          tabIndex={readOnly ? 0 : undefined}
        >
          <table ref={tableRef} aria-label={label}>
            <thead>
              <tr>
                {columns.map((column, columnIndex) => (
                  <th
                    scope="col"
                    key={column.path}
                    data-summary-column={columnIndex}
                    data-column-compact={column.compact || undefined}
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
                <Fragment key={row.path}>
                  <tr
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
                        data-column-compact={columns[columnIndex]?.compact || undefined}
                        data-editable={cell.editor ? 'true' : undefined}
                        data-column-numeric={readOnly && columns[columnIndex]?.numeric ? true : undefined}
                        data-summary={columns[columnIndex]?.path === '$summary' || undefined}
                        data-field-path={cell.path}
                        tabIndex={-1}
                        title={cell.error ?? cell.text}
                        data-empty={cell.empty ? 'true' : undefined}
                        data-invalid={cell.error ? 'true' : undefined}
                      >
                        {cell.editor ?? (
                          <span className={readOnly && columns[columnIndex]?.numeric ? 'block' : 'block truncate'}>
                            {cell.text}
                          </span>
                        )}
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
                          aria-expanded={expandedIndex === index}
                          aria-controls={expandedIndex === index ? `${detailId}-${index}` : undefined}
                          aria-label={`${expandedIndex === index ? 'Collapse' : 'Expand'} ${row.label} in place`}
                          title={expandedIndex === index ? 'Collapse in place' : 'Expand in place'}
                          onClick={(event) => {
                            event.stopPropagation();
                            onToggleExpanded(index);
                          }}
                        >
                          <ChevronRight
                            className={`size-3.5 ${expandedIndex === index ? 'rotate-90' : ''}`}
                            aria-hidden="true"
                          />
                        </Button>
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
                        {onRemove && (
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
                        )}
                      </div>
                    </td>
                  </tr>
                  {expandedIndex === index && (
                    <tr className="preview-object-grid__detail">
                      <td colSpan={columns.length + 1}>
                        <div id={`${detailId}-${index}`} role="group" aria-label={`${row.label} fields`}>
                          {renderExpandedRow(index)}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <p className="preview-object-grid__empty">
              {onRemove ? 'No items yet. Add an item to edit its details.' : 'No items.'}
            </p>
          )}
        </div>
      </>
    );
  },
  { op: 'PreviewObjectGrid' }
);
