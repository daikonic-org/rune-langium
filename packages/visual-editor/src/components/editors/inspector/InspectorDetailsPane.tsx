// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from '@rune-langium/design-system/ui/button';
import { ChevronDown, ChevronUp, X } from 'lucide-react';

export interface InspectorDetailsPaneProps {
  targetName?: string;
  children: ReactNode;
  onClear?: () => void;
  elementLabel?: string;
}

/** A bounded local layout preference; no model, draft or persistence ownership. */
export function InspectorDetailsPane({
  targetName,
  children,
  onClear,
  elementLabel = 'Member'
}: InspectorDetailsPaneProps) {
  const id = useId();
  const element = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(!targetName);
  const [size, setSize] = useState(220);
  const [max, setMax] = useState(400);
  const drag = useRef<{ pointer: number; y: number; size: number } | undefined>(undefined);
  useEffect(() => {
    if (targetName) setCollapsed(false);
  }, [targetName]);
  useEffect(() => {
    const frame = element.current?.closest('[data-slot="inspector-frame"]') ?? element.current?.parentElement;
    if (!frame) return;
    const update = () => {
      const available = frame.getBoundingClientRect().height;
      if (available > 0) setMax(Math.max(96, Math.floor(available * 0.6)));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);
  const height = Math.min(max, Math.max(96, size));
  const move = (value: number) => setSize(Math.min(max, Math.max(96, value)));
  return (
    <div
      ref={element}
      data-slot="inspector-details-pane"
      className="flex min-h-0 shrink-0 flex-col border-t border-border"
      style={collapsed ? undefined : { height }}
    >
      {!collapsed && (
        <div
          role="separator"
          aria-label="Resize item details"
          aria-orientation="horizontal"
          aria-controls={id}
          aria-valuemin={96}
          aria-valuemax={max}
          aria-valuenow={height}
          tabIndex={0}
          className="h-2 shrink-0 cursor-row-resize touch-none bg-muted/30 focus-visible:outline focus-visible:outline-ring"
          onKeyDown={(event) => {
            const next =
              event.key === 'Home'
                ? 96
                : event.key === 'End'
                  ? max
                  : event.key === 'ArrowUp'
                    ? height + 20
                    : event.key === 'ArrowDown'
                      ? height - 20
                      : undefined;
            if (next !== undefined) {
              event.preventDefault();
              move(next);
            }
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            drag.current = { pointer: event.pointerId, y: event.clientY, size: height };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const start = drag.current;
            if (start?.pointer === event.pointerId) move(start.size + start.y - event.clientY);
          }}
          onPointerUp={(event) => {
            drag.current = undefined;
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => {
            drag.current = undefined;
          }}
          onLostPointerCapture={() => {
            drag.current = undefined;
          }}
        />
      )}
      <div className="flex shrink-0 items-center justify-between gap-2 py-1.5 text-base">
        <span
          className="min-w-0 truncate font-medium"
          title={targetName ? `${elementLabel}: ${targetName}` : elementLabel}
        >
          {targetName ? `${elementLabel}: ${targetName}` : elementLabel}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {targetName && onClear && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onClear}
              aria-label="Clear item selection"
              title="Clear item selection"
            >
              <X className="size-3.5" aria-hidden="true" />
            </Button>
          )}
          <Button
            variant="outline"
            size="icon-xs"
            aria-expanded={!collapsed}
            aria-controls={id}
            aria-label={collapsed ? 'Expand item details' : 'Collapse item details'}
            title={collapsed ? 'Expand item details' : 'Collapse item details'}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? (
              <ChevronUp className="size-3.5" aria-hidden="true" />
            ) : (
              <ChevronDown className="size-3.5" aria-hidden="true" />
            )}
          </Button>
        </div>
      </div>
      <div
        id={id}
        role="region"
        aria-label={targetName ? `Details: ${targetName}` : 'Item details'}
        hidden={collapsed}
        className="studio-scroll min-h-0 flex-1 overflow-auto pb-3"
      >
        {targetName ? (
          children
        ) : (
          <p className="text-xs text-muted-foreground">Select a member to inspect its details.</p>
        )}
      </div>
    </div>
  );
}
