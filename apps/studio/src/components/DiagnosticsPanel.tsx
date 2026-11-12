// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * DiagnosticsPanel — Error/warning list with navigation (T041).
 *
 * Displays LSP diagnostics grouped by file. Clicking a diagnostic
 * navigates to the source location in the editor.
 *
 * Uses @tanstack/react-virtual for virtualized rendering of large
 * diagnostic lists.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  AlertCircle,
  AlertTriangle,
  FileWarning,
  Info,
  Lightbulb,
  CheckCircle2,
  Filter,
  MoreHorizontal
} from 'lucide-react';
import type { LspDiagnostic } from '../store/diagnostics-store.js';
import { Popover, PopoverContent, PopoverTrigger } from '@rune-langium/design-system/ui/popover';
import { NumberChiclet } from '@rune-langium/design-system/ui/number-chiclet';
import { Button } from '@rune-langium/design-system/ui/button';
import { cn } from '@rune-langium/design-system/utils';
import { flattenDiagnostics } from '../utils/flatten-diagnostics.js';
import type { FlatDiagnosticRow } from '../utils/flatten-diagnostics.js';
import { withInstrumentation } from '../services/instrumentation/core.js';
import { useUtilityHeaderActions } from '../shell/utility-header-actions-context.js';

export interface DiagnosticsPanelProps {
  fileDiagnostics: Map<string, LspDiagnostic[]>;
  onNavigate?: (uri: string, line: number, character: number) => void;
}

type SeverityKind = 'error' | 'warning' | 'info' | 'hint';

function extractFileName(uri: string): string {
  const parts = uri.split('/');
  return parts[parts.length - 1] ?? uri;
}

function severityLabel(severity?: number): SeverityKind {
  switch (severity) {
    case 1:
      return 'error';
    case 2:
      return 'warning';
    case 3:
      return 'info';
    case 4:
      return 'hint';
    default:
      return 'error';
  }
}

const FILE_HEADER_HEIGHT = 28;
const DIAGNOSTIC_ROW_HEIGHT = 36;

const SEVERITY_ORDER: SeverityKind[] = ['error', 'warning', 'info', 'hint'];

const DEFAULT_VISIBLE_SEVERITIES: Record<SeverityKind, boolean> = {
  error: true,
  warning: true,
  info: true,
  hint: true
};

interface ProblemCounts {
  errors: number;
  warnings: number;
  info: number;
  hints: number;
  total: number;
}

function countProblems(fileDiagnostics: Map<string, LspDiagnostic[]>): ProblemCounts {
  const counts: ProblemCounts = {
    errors: 0,
    warnings: 0,
    info: 0,
    hints: 0,
    total: 0
  };
  for (const diags of fileDiagnostics.values()) {
    for (const d of diags) {
      counts.total++;
      switch (d.severity) {
        case 2:
          counts.warnings++;
          break;
        case 3:
          counts.info++;
          break;
        case 4:
          counts.hints++;
          break;
        default:
          counts.errors++;
          break;
      }
    }
  }
  return counts;
}

export const DiagnosticsPanel = withInstrumentation(
  function DiagnosticsPanel({ fileDiagnostics, onNavigate }: DiagnosticsPanelProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [visibleSeverities, setVisibleSeverities] =
      useState<Record<SeverityKind, boolean>>(DEFAULT_VISIBLE_SEVERITIES);
    const [showSummary, setShowSummary] = useState(true);

    const filteredDiagnostics = useMemo(() => {
      const filtered = new Map<string, LspDiagnostic[]>();
      for (const [uri, diagnostics] of fileDiagnostics) {
        const matching = diagnostics.filter((diagnostic) => visibleSeverities[severityLabel(diagnostic.severity)]);
        if (matching.length > 0) {
          filtered.set(uri, matching);
        }
      }
      return filtered;
    }, [fileDiagnostics, visibleSeverities]);

    const flatRows = useMemo(() => flattenDiagnostics(filteredDiagnostics), [filteredDiagnostics]);
    const counts = useMemo(() => countProblems(filteredDiagnostics), [filteredDiagnostics]);
    const rawCounts = useMemo(() => countProblems(fileDiagnostics), [fileDiagnostics]);
    const diagnosticsByFile = useMemo(
      () => new Map(Array.from(filteredDiagnostics.entries(), ([uri, diags]) => [uri, diags.length])),
      [filteredDiagnostics]
    );
    const fileCount = diagnosticsByFile.size;
    const hasActiveSeverityFilters = SEVERITY_ORDER.some((severity) => !visibleSeverities[severity]);
    const isEmpty = counts.total === 0;
    const isFilteredEmpty = rawCounts.total > 0 && isEmpty;

    const toggleSeverity = useCallback((severity: SeverityKind) => {
      setVisibleSeverities((current) => ({ ...current, [severity]: !current[severity] }));
    }, []);

    const resetFilters = useCallback(() => {
      setVisibleSeverities(DEFAULT_VISIBLE_SEVERITIES);
    }, []);

    const toggleSummary = useCallback(() => setShowSummary((current) => !current), []);

    // Publish the Filter / "..." popovers into the dockview group header
    // (first row) via the utility header-actions registry — they stay
    // visible and usable while the tray is collapsed to header height.
    // Memoized so the registry effect only re-registers on real state
    // changes (all handlers are stable useCallbacks).
    const headerActions = useMemo(
      () => (
        <ProblemsHeaderActions
          hasActiveSeverityFilters={hasActiveSeverityFilters}
          showSummary={showSummary}
          onToggleSummary={toggleSummary}
          onResetFilters={resetFilters}
          visibleSeverities={visibleSeverities}
          onToggleSeverity={toggleSeverity}
        />
      ),
      [hasActiveSeverityFilters, showSummary, toggleSummary, resetFilters, visibleSeverities, toggleSeverity]
    );
    useUtilityHeaderActions('workspace.problems', headerActions);

    const virtualizer = useVirtualizer({
      count: flatRows.length,
      getScrollElement: () => scrollRef.current,
      estimateSize: (index) => (flatRows[index]?.kind === 'file-header' ? FILE_HEADER_HEIGHT : DIAGNOSTIC_ROW_HEIGHT),
      overscan: 5
    });

    if (isEmpty) {
      return (
        <section
          className="flex h-full min-h-0 flex-col overflow-hidden"
          data-testid="diagnostics-panel"
          aria-label="Diagnostics"
        >
          <PanelHeader
            total={counts.total}
            rawTotal={rawCounts.total}
            hasActiveSeverityFilters={hasActiveSeverityFilters}
          />
          <div className="flex flex-1 items-center justify-center px-4 py-6">
            <div className="flex max-w-60 flex-col items-center gap-2 text-center">
              <span className="rounded-full border border-border/70 bg-background/70 p-2 shadow-sm">
                <CheckCircle2 className="size-4 text-emerald-500" aria-hidden />
              </span>
              <p className="text-sm font-medium text-foreground">
                {isFilteredEmpty ? 'No matching problems' : 'No problems detected'}
              </p>
              <p className="text-xs text-muted-foreground">
                {isFilteredEmpty
                  ? 'Adjust the active severity filters to bring hidden diagnostics back into view.'
                  : 'Parser, validation, and linker issues will appear here as you edit.'}
              </p>
              {isFilteredEmpty ? (
                <Button type="button" variant="link" size="xs" onClick={resetFilters}>
                  Show all severities
                </Button>
              ) : null}
            </div>
          </div>
        </section>
      );
    }

    return (
      <section
        className="flex h-full min-h-0 flex-col overflow-hidden"
        data-testid="diagnostics-panel"
        aria-label="Diagnostics"
      >
        <PanelHeader
          total={counts.total}
          rawTotal={rawCounts.total}
          hasActiveSeverityFilters={hasActiveSeverityFilters}
        />
        {showSummary ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-border/70 bg-card/40 px-3 py-2 text-sm">
            <SeverityPill severity="error" count={counts.errors} />
            <SeverityPill severity="warning" count={counts.warnings} />
            <SeverityPill severity="info" count={counts.info} />
            <SeverityPill severity="hint" count={counts.hints} />
            <NumberChiclet title={`${fileCount} file${fileCount === 1 ? '' : 's'}`}>
              {fileCount} file{fileCount === 1 ? '' : 's'}
            </NumberChiclet>
          </div>
        ) : null}

        <div ref={scrollRef} className="studio-scroll flex-1 overflow-auto">
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative'
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = flatRows[virtualRow.index]!;
              return (
                <div
                  key={virtualRow.key}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`
                  }}
                >
                  {row.kind === 'file-header' ? (
                    <FileHeaderRow uri={row.uri} count={diagnosticsByFile.get(row.uri) ?? 0} />
                  ) : (
                    <DiagnosticItemRow row={row} onNavigate={onNavigate} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>
    );
  },
  { op: 'DiagnosticsPanel' }
);

function PanelHeader({
  total,
  rawTotal,
  hasActiveSeverityFilters
}: {
  total: number;
  rawTotal: number;
  hasActiveSeverityFilters: boolean;
}) {
  const titleMeta =
    rawTotal === 0
      ? '· clear'
      : hasActiveSeverityFilters
        ? `· ${total}/${rawTotal} shown`
        : `· ${total} problem${total === 1 ? '' : 's'}`;

  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/70 px-3 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
          <FileWarning className="size-4 text-muted-foreground" aria-hidden />
          <span>Problems</span>
          <span className="font-mono text-2xs text-muted-foreground">{titleMeta}</span>
        </div>
        <p className="mt-0.5 text-2xs text-muted-foreground">
          {hasActiveSeverityFilters
            ? 'Filter active — only matching severities are shown.'
            : 'Review diagnostics and jump straight to the affected source.'}
        </p>
      </div>
    </div>
  );
}

/**
 * Filter + "..." popovers, published into the dockview group header (first
 * row) via useUtilityHeaderActions — NOT rendered inside the panel body, so
 * they remain visible/usable while the utility tray is collapsed.
 */
function ProblemsHeaderActions({
  hasActiveSeverityFilters,
  showSummary,
  onToggleSummary,
  onResetFilters,
  visibleSeverities,
  onToggleSeverity
}: {
  hasActiveSeverityFilters: boolean;
  showSummary: boolean;
  onToggleSummary: () => void;
  onResetFilters: () => void;
  visibleSeverities: Record<SeverityKind, boolean>;
  onToggleSeverity: (severity: SeverityKind) => void;
}) {
  return (
    <>
      <Popover>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
              data-active={hasActiveSeverityFilters ? 'true' : undefined}
              aria-label="Filter diagnostics"
              title="Filter diagnostics"
            >
              <Filter className="size-4" />
            </Button>
          }
        />
        <PopoverContent className="w-56 p-2" align="end" sideOffset={6}>
          <div className="space-y-1">
            <p className="px-2 pb-1 text-3xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Visible severities
            </p>
            {SEVERITY_ORDER.map((severity) => {
              const active = visibleSeverities[severity];
              return (
                <Button
                  key={severity}
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="w-full justify-between text-muted-foreground"
                  aria-pressed={active}
                  onClick={() => onToggleSeverity(severity)}
                >
                  <span className="inline-flex items-center gap-2">
                    <span
                      className={cn(
                        'size-2.5 rounded-full border',
                        severity === 'error' && 'border-destructive bg-destructive',
                        severity === 'warning' && 'border-warning bg-warning',
                        severity === 'info' && 'border-info bg-info',
                        severity === 'hint' && 'border-data bg-data',
                        !active && 'bg-transparent opacity-60'
                      )}
                    />
                    <span className="capitalize">{severity}</span>
                  </span>
                  <span className="text-3xs font-medium uppercase tracking-[0.12em]">{active ? 'On' : 'Off'}</span>
                </Button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
      <Popover>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
              aria-label="Problem panel options"
              title="Problem panel options"
            >
              <MoreHorizontal className="size-4" />
            </Button>
          }
        />
        <PopoverContent className="w-52 p-2" align="end" sideOffset={6}>
          <div className="space-y-1">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="w-full justify-between"
              aria-pressed={showSummary}
              onClick={onToggleSummary}
            >
              <span>{showSummary ? 'Hide summary row' : 'Show summary row'}</span>
              <span className="text-3xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {showSummary ? 'On' : 'Off'}
              </span>
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="xs"
              className="w-full justify-between"
              onClick={onResetFilters}
              disabled={!hasActiveSeverityFilters}
            >
              <span>Show all severities</span>
              <span className="text-3xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Reset</span>
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}

function SeverityPill({ severity, count }: { severity: SeverityKind; count: number }) {
  if (count === 0) return null;

  const meta: Record<
    SeverityKind,
    {
      icon: typeof AlertCircle;
      label: string;
      className: string;
      iconClassName: string;
    }
  > = {
    error: {
      icon: AlertCircle,
      label: count === 1 ? 'error' : 'errors',
      className: 'border-destructive/25 bg-destructive/8 text-destructive',
      iconClassName: 'text-destructive'
    },
    warning: {
      icon: AlertTriangle,
      label: count === 1 ? 'warning' : 'warnings',
      className: 'border-warning/25 bg-warning/10 text-warning',
      iconClassName: 'text-warning'
    },
    info: {
      icon: Info,
      label: count === 1 ? 'info' : 'info',
      className: 'border-info/25 bg-info/10 text-info',
      iconClassName: 'text-info'
    },
    hint: {
      icon: Lightbulb,
      label: count === 1 ? 'hint' : 'hints',
      className: 'border-border/80 bg-muted/60 text-muted-foreground',
      iconClassName: 'text-amber-400'
    }
  };

  const Icon = meta[severity].icon;
  return (
    <span
      title={`${count} ${meta[severity].label}`}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium',
        meta[severity].className
      )}
    >
      <NumberChiclet>{count}</NumberChiclet>
      <Icon className={cn('size-3.5', meta[severity].iconClassName)} aria-hidden />
      <span>{meta[severity].label}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// FileHeaderRow
// ---------------------------------------------------------------------------

function FileHeaderRow({ uri, count }: { uri: string; count: number }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-card/70 px-3 py-1.5 text-xs font-semibold tracking-wide text-muted-foreground">
      <span className="truncate uppercase" title={uri}>
        {extractFileName(uri)}
      </span>
      <NumberChiclet title={`${count} problem${count === 1 ? '' : 's'}`}>{count}</NumberChiclet>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DiagnosticItemRow
// ---------------------------------------------------------------------------

interface DiagnosticItemRowProps {
  row: Extract<FlatDiagnosticRow, { kind: 'diagnostic' }>;
  onNavigate?: (uri: string, line: number, character: number) => void;
}

function DiagnosticItemRow({ row, onNavigate }: DiagnosticItemRowProps) {
  const { uri, diagnostic: diag } = row;
  const sev = severityLabel(diag.severity);
  const line = diag.range.start.line + 1;
  const col = diag.range.start.character + 1;

  return (
    <button
      className={cn(
        'flex w-full items-center gap-2 border-none bg-transparent px-3 py-1.5 pl-4 text-left text-sm text-foreground',
        'hover:bg-card/80',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1'
      )}
      onClick={() => onNavigate?.(uri, diag.range.start.line, diag.range.start.character)}
      type="button"
    >
      <span
        className={cn(
          'inline-flex size-6 shrink-0 items-center justify-center rounded-full border',
          sev === 'error' && 'border-destructive/20 bg-destructive/10 text-destructive',
          sev === 'warning' && 'border-warning/20 bg-warning/10 text-warning',
          sev === 'info' && 'border-info/20 bg-info/10 text-info',
          sev === 'hint' && 'border-border/80 bg-muted/50 text-amber-400'
        )}
        aria-label={sev}
      >
        {sev === 'error' ? (
          <AlertCircle className="size-3.5" aria-hidden />
        ) : sev === 'warning' ? (
          <AlertTriangle className="size-3.5" aria-hidden />
        ) : sev === 'hint' ? (
          <Lightbulb className="size-3.5" aria-hidden />
        ) : (
          <Info className="size-3.5" aria-hidden />
        )}
      </span>
      <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{diag.message}</span>
      <span className="shrink-0 font-mono text-2xs text-muted-foreground">
        {line}:{col}
      </span>
    </button>
  );
}
