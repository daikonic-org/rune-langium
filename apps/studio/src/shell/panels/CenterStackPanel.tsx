// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { Fragment, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type React from 'react';
import { Network, FileCode2, Info, Layers } from 'lucide-react';
import { GraphFilterMenu } from '../../components/GraphFilterMenu.js';
import { useCenterPanes, type CenterPane } from '../center-panes-context.js';
import { withInstrumentation } from '../../services/instrumentation/core.js';

import { SourceNavigationFeedbackContext } from '../source-navigation-feedback-context.js';

const PANE_GROUPS: ReadonlyArray<{ label: string; panes: readonly CenterPane[] }> = [
  { label: 'View', panes: ['graph', 'structure'] },
  { label: 'Show alongside', panes: ['source', 'inspector'] }
];
const PANE_ORDER = PANE_GROUPS.flatMap(({ panes }) => panes);
const PANE_LABELS: Record<CenterPane, string> = {
  graph: 'Graph',
  structure: 'Structure',
  source: 'Source',
  inspector: 'Inspector'
};
const PANE_ICONS: Record<CenterPane, React.FC<React.SVGProps<SVGSVGElement>>> = {
  graph: Network,
  structure: Layers,
  source: FileCode2,
  inspector: Info
};
const MIN_PANE_PX = 120;

interface CenterStackPanelProps {
  /** Identity changes restart the delayed cue; hidden panes never pulse. */
  sourceNavigationPending?: object | null;
  renderGraph: () => React.ReactElement | null;
  renderSource: () => React.ReactElement | null;
  renderInspector: () => React.ReactElement | null;
  renderStructure: () => React.ReactElement | null;
}

export const CenterStackPanel = withInstrumentation(
  function CenterStackPanel({
    renderGraph,
    renderSource,
    renderInspector,
    renderStructure,
    sourceNavigationPending: pendingOverride
  }: CenterStackPanelProps): React.ReactElement {
    const { activePanes, toggle } = useCenterPanes();
    const pendingContext = useContext(SourceNavigationFeedbackContext);
    const sourceNavigationPending = pendingOverride === undefined ? pendingContext : pendingOverride;
    const sourceVisible = activePanes.has('source');
    const [visibleRequest, setVisibleRequest] = useState<object | null>(null);
    useEffect(() => {
      if (!sourceVisible || !sourceNavigationPending) return;
      const timer = setTimeout(() => setVisibleRequest(sourceNavigationPending), 250);
      return () => clearTimeout(timer);
    }, [sourceVisible, sourceNavigationPending]);
    const sourcePending =
      sourceVisible && Boolean(sourceNavigationPending) && visibleRequest === sourceNavigationPending;
    const ordered = PANE_ORDER.filter((p) => activePanes.has(p));
    const containerRef = useRef<HTMLDivElement>(null);

    const [fractions, setFractions] = useState<number[]>(() => ordered.map(() => 1 / ordered.length));

    // Tracked via useState, NOT a plain ref: a ref mutation made during render
    // is not rolled back if React discards/retries this render under
    // concurrent rendering, while the accompanying setFractions call IS rolled
    // back (it never committed) — so a bare `.current = ...` assignment could
    // leave a retry believing this pane-count change was already handled and
    // skip re-equalizing the split fractions (same class of issue Codex
    // flagged across several dialogs in this PR).
    // While a split-handle drag is live, pane flex must track the pointer
    // 1:1 — the CSS flex transition is disabled via this class.
    const [isDragging, setIsDragging] = useState(false);

    const [prevCount, setPrevCount] = useState(ordered.length);
    if (ordered.length !== prevCount) {
      setPrevCount(ordered.length);
      const equal = ordered.map(() => 1 / ordered.length);
      if (JSON.stringify(equal) !== JSON.stringify(fractions)) {
        setFractions(equal);
      }
    }

    const handleDragStart = useCallback(
      (splitIndex: number, e: React.MouseEvent) => {
        e.preventDefault();
        const container = containerRef.current;
        if (!container) return;
        const totalWidth = container.offsetWidth;
        const startX = e.clientX;
        const startFractions = [...fractions];

        const onMove = (ev: MouseEvent) => {
          const dx = ev.clientX - startX;
          const dFrac = dx / totalWidth;
          const next = [...startFractions];
          const left = splitIndex;
          const right = splitIndex + 1;
          const minFrac = MIN_PANE_PX / totalWidth;
          next[left] = Math.max(minFrac, startFractions[left]! + dFrac);
          next[right] = Math.max(minFrac, startFractions[right]! - dFrac);
          const sum = next.reduce((a, b) => a + b, 0);
          setFractions(next.map((f) => f / sum));
        };

        const onUp = () => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          setIsDragging(false);
        };

        setIsDragging(true);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      },
      [fractions]
    );

    const renderPane = (pane: CenterPane): React.ReactElement | null => {
      switch (pane) {
        case 'graph':
          return renderGraph();
        case 'structure':
          return renderStructure();
        case 'source':
          return renderSource();
        case 'inspector':
          return renderInspector();
      }
    };

    return (
      <div className="studio-center-stack-container flex flex-col h-full min-h-0">
        {/* Paneswitch pill — sits below the dockview tab strip */}
        <div
          className="studio-center-stack__bar"
          role="toolbar"
          aria-label="Center pane selector"
          data-testid="studio-paneswitch"
        >
          <div className="studio-paneswitch gap-4">
            {PANE_GROUPS.map(({ label, panes }) => (
              <div key={label} className="flex h-full" role="group" aria-label={label}>
                {panes.map((pane) => {
                  const isActive = activePanes.has(pane);
                  const Icon = PANE_ICONS[pane];
                  return (
                    <button
                      key={pane}
                      type="button"
                      aria-pressed={isActive}
                      className={isActive ? 'studio-paneswitch__seg is-active' : 'studio-paneswitch__seg'}
                      onClick={() => toggle(pane)}
                    >
                      <Icon
                        className={
                          pane === 'source' && sourcePending ? 'size-3.5 studio-navigation-pending' : 'size-3.5'
                        }
                        aria-hidden
                      />
                      {PANE_LABELS[pane]}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="flex-1" />
          <div className="studio-panel-actions" aria-label="Center stack actions">
            <GraphFilterMenu compact align="end" />
          </div>
        </div>

        {/* Pane body — active panes split side-by-side */}
        <div
          ref={containerRef}
          className={isDragging ? 'studio-center-stack is-dragging' : 'studio-center-stack'}
          data-count={ordered.length}
          data-testid="center-stack"
        >
          {ordered.map((pane, i) => (
            <Fragment key={pane}>
              {i > 0 && (
                <div
                  className="studio-center-stack__split"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize panes"
                  onMouseDown={(e) => handleDragStart(i - 1, e)}
                />
              )}
              <div
                className="studio-center-stack__pane text-sm"
                data-pane={pane}
                style={{
                  // e2e-batch fix: was `flex: <grow> 1 0%`, which gives a 0% basis
                  // and stops children from growing past the equal split. Inner
                  // panes (Structure View especially) need a real basis so their
                  // content (React Flow tree) can size correctly. `minWidth: 0`
                  // keeps flex-shrink working — without it overflowing children
                  // would force the pane wider than its share. `minHeight: 0`
                  // mirrors the same protection for the vertical axis.
                  //
                  // Codex P1 review: an earlier revision added
                  // `minInlineSize: 280px` when multi-pane to keep panes legible.
                  // That hard minimum × pane count clipped the rightmost panes at
                  // common laptop widths (3 panes × 280 = 840 + splitters > 800
                  // viewport). Dropped — `minWidth: 0` lets panes genuinely shrink,
                  // and the user can collapse panes via the pane-switcher pill
                  // when more space is needed for the active ones.
                  flex: `${fractions[i] ?? 1 / ordered.length} 1 0`,
                  minWidth: 0,
                  minHeight: 0
                }}
              >
                {renderPane(pane)}
              </div>
            </Fragment>
          ))}
        </div>
      </div>
    );
  },
  { op: 'CenterStackPanel' }
);
