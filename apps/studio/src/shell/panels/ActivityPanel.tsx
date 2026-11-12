// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@rune-langium/design-system/utils';
import { NativeSelect } from '@rune-langium/design-system/ui/select';
import { Button } from '@rune-langium/design-system/ui/button';
import { useUtilityHeaderActions } from '../utility-header-actions-context.js';
import { useActivityStore } from '../../store/activity-store.js';
import { withInstrumentation } from '../../services/instrumentation/core.js';
import type { InstrumentationNamespace } from '../../services/instrumentation/namespace.js';
import { formatTelemetryEntryDetails } from './telemetry-entry-details.js';

const NAMESPACE_FILTERS: Array<InstrumentationNamespace | 'all'> = [
  'all',
  'codegen',
  'lsp',
  'workspace',
  'git',
  'form-preview',
  'curated',
  'instrumentation'
];

export const ActivityPanel = withInstrumentation(
  function ActivityPanel(): React.ReactElement {
    const entries = useActivityStore((s) => s.entries);
    const clearEntries = useActivityStore((s) => s.clearEntries);
    const scrollRef = useRef<HTMLDivElement>(null);
    const [filter, setFilter] = useState<InstrumentationNamespace | 'all'>('all');

    const filteredEntries = useMemo(
      () => (filter === 'all' ? entries : entries.filter((entry) => entry.tag === filter)),
      [entries, filter]
    );

    useEffect(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }, [filteredEntries]);

    // Filter + Clear live in the dockview group header (first row) so they
    // stay visible while the utility tray is collapsed to header height.
    const headerActions = useMemo(
      () => (
        <>
          <NativeSelect
            value={filter}
            onChange={(event) => {
              const next = NAMESPACE_FILTERS.find((namespace) => namespace === event.target.value);
              if (next) setFilter(next);
            }}
            aria-label="Filter activity by namespace"
            data-testid="activity-namespace-filter"
            className="min-w-28"
          >
            {NAMESPACE_FILTERS.map((namespace) => (
              <option key={namespace} value={namespace}>
                {namespace === 'all' ? 'All' : namespace}
              </option>
            ))}
          </NativeSelect>
          <Button type="button" variant="secondary" size="xs" onClick={clearEntries}>
            Clear
          </Button>
        </>
      ),
      [filter, clearEntries]
    );
    useUtilityHeaderActions('workspace.activity', headerActions);

    return (
      <section
        aria-label="Activity"
        data-testid="panel-activity"
        data-component="workspace.activity"
        className="flex h-full min-h-0 flex-col overflow-hidden"
      >
        <div ref={scrollRef} aria-live="polite" className="studio-scroll flex-1 overflow-auto px-1 py-1">
          {filteredEntries.length === 0 ? (
            <p className="px-2 py-3 font-mono text-2xs text-muted-foreground/60">
              {entries.length === 0 ? 'No activity yet.' : 'No activity matches this filter.'}
            </p>
          ) : (
            <div className="flex flex-col gap-0.5 font-mono text-xs">
              {filteredEntries.map((entry) => (
                <div
                  key={entry.id}
                  title={formatTelemetryEntryDetails({
                    message: entry.msg,
                    status: entry.ok ? 'Success' : 'Error',
                    op: entry.op ?? entry.tag,
                    time: entry.time,
                    durationMs: entry.durationMs,
                    signature: entry.signature,
                    subject: entry.subject,
                    opId: entry.opId
                  })}
                  className="studio-fade-in grid items-center gap-2.5 rounded px-1.5 py-1 text-foreground/70 transition-colors hover:bg-accent"
                  style={{ gridTemplateColumns: '48px 80px 1fr' }}
                >
                  <span className="text-muted-foreground/60">{entry.time}</span>
                  <span
                    className={cn(
                      'rounded-full px-1.5 py-px text-center text-3xs font-semibold uppercase tracking-[0.04em]',
                      entry.ok ? 'bg-teal-400/10 text-teal-400' : 'bg-destructive/15 text-destructive'
                    )}
                  >
                    {entry.tag}
                  </span>
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap">{entry.msg}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    );
  },
  { op: 'ActivityPanel' }
);
