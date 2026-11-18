// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Daikonic contributors

import { Fragment, useEffect, useId, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  useDefaultLayout,
  type GroupImperativeHandle
} from '@rune-langium/design-system/ui/resizable';
import { withInstrumentation } from '../services/instrumentation/core.js';

type PaneSizes = Pick<ComponentProps<typeof ResizablePanel>, 'defaultSize' | 'minSize' | 'maxSize'>;

export interface WorkbenchPane extends PaneSizes {
  id: string;
  content: ReactNode;
  visible?: boolean;
  /** Accessible name of the divider immediately before this pane. */
  separatorLabel?: string;
  /** Sizes for the vertical layout below stackAt. */
  stacked?: PaneSizes;
}

/** Personal layout storage stays separate from Rune documents and workspace files. */
function layoutStorage(persistent: boolean): Pick<Storage, 'getItem' | 'setItem'> {
  const memory = new Map<string, string>();
  return {
    getItem(key) {
      let value = memory.get(key) ?? null;
      try {
        if (persistent) value = localStorage.getItem(key) ?? value;
      } catch {
        // Keep this mount's sizes when browser preference storage is unavailable.
      }
      try {
        const layout: unknown = value ? JSON.parse(value) : null;
        if (!layout || typeof layout !== 'object' || Array.isArray(layout)) return null;
        const sizes = Object.values(layout);
        return sizes.length &&
          Math.abs(sizes.reduce<number>((sum, size) => sum + (typeof size === 'number' ? size : 0), 0) - 100) < 0.01 &&
          sizes.every((size) => typeof size === 'number' && Number.isFinite(size) && size >= 0 && size <= 100)
          ? value
          : null;
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      memory.set(key, value);
      try {
        if (persistent) localStorage.setItem(key, value);
      } catch {
        // Resizing still works when browser preference storage is unavailable.
      }
    }
  };
}

/** Shared bounded, keyboard/touch-resizable layout for workbenches without docking. */
export const SplitWorkbench = withInstrumentation(
  function SplitWorkbench({
    panes,
    storageKey,
    orientation = 'horizontal',
    stackAt,
    className = ''
  }: {
    panes: readonly WorkbenchPane[];
    storageKey?: string;
    orientation?: 'horizontal' | 'vertical';
    stackAt?: number;
    className?: string;
  }) {
    const generatedId = useId();
    const group = useRef<GroupImperativeHandle | null>(null);
    const [element, setElement] = useState<HTMLDivElement | null>(null);
    const [stacked, setStacked] = useState(false);
    useEffect(() => {
      if (!element || !stackAt) return;
      const resize = new ResizeObserver(([entry]) => {
        if (entry && entry.contentRect.width > 0) setStacked(entry.contentRect.width < stackAt);
      });
      resize.observe(element);
      return () => resize.disconnect();
    }, [element, stackAt]);
    const direction = stacked ? 'vertical' : orientation;
    const visible = panes.filter((pane) => pane.visible !== false);
    const storage = useMemo(() => layoutStorage(Boolean(storageKey)), [storageKey]);
    const { defaultLayout, onLayoutChanged } = useDefaultLayout({
      id: `rune:split-workbench:${storageKey ?? generatedId}:${direction}`,
      panelIds: visible.map((pane) => pane.id),
      storage,
      onlySaveAfterUserInteractions: true
    });
    useEffect(() => {
      // defaultLayout initializes a Group; a responsive axis change must also
      // restore its saved layout in place, without remounting editors/canvases.
      if (!defaultLayout) return;
      const frame = requestAnimationFrame(() => {
        const current = group.current?.getLayout();
        const ids = Object.keys(defaultLayout);
        // Panel registration settles after visibility changes. Never apply a
        // layout for a different panel set to the live Group.
        if (!current || ids.length !== Object.keys(current).length || ids.some((id) => !(id in current))) return;
        if (ids.some((id) => Math.abs(current[id]! - defaultLayout[id]!) > 0.01))
          group.current?.setLayout(defaultLayout);
      });
      return () => cancelAnimationFrame(frame);
    }, [defaultLayout, direction]);
    return (
      <ResizablePanelGroup
        elementRef={setElement}
        groupRef={group}
        orientation={direction}
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
        className={`min-h-0 min-w-0 flex-1 ${className}`}
        data-workbench-orientation={direction}
      >
        {visible.map((pane, index) => (
          <Fragment key={pane.id}>
            {index > 0 && (
              <ResizableHandle
                withHandle
                aria-label={pane.separatorLabel ?? 'Resize panes'}
                className="shrink-0 bg-border hover:bg-primary/40 focus-visible:bg-primary/40"
              />
            )}
            <ResizablePanel
              id={pane.id}
              defaultSize={pane.defaultSize}
              minSize={pane.minSize}
              maxSize={pane.maxSize}
              {...(stacked ? pane.stacked : undefined)}
            >
              {pane.content}
            </ResizablePanel>
          </Fragment>
        ))}
      </ResizablePanelGroup>
    );
  },
  { op: 'SplitWorkbench', capture: 0 }
);
