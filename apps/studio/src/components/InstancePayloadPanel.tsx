// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Button } from '@rune-langium/design-system/ui/button';
import type { PayloadView } from './FormPreviewPanel.js';
import { withInstrumentation } from '../services/instrumentation/core.js';
import { copyTextToClipboard } from '../services/clipboard.js';

export interface InstancePayloadPanelProps {
  payload: PayloadView;
  onExport(): Promise<void>;
}

export const InstancePayloadPanel = withInstrumentation(
  function InstancePayloadPanel({ payload, onExport }: InstancePayloadPanelProps): ReactElement {
    const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
    const [exportFeedback, setExportFeedback] = useState<string | null>(null);
    const [exporting, setExporting] = useState(false);
    const [copying, setCopying] = useState(false);
    const scope = useRef(0);
    const exportPending = useRef(false);
    const copyPending = useRef(false);
    const serialized = JSON.stringify(payload.value, null, 2);
    const title =
      payload.kind === 'inputs' ? 'Function inputs' : payload.kind === 'result' ? 'Function result' : 'Payload';

    useEffect(() => {
      scope.current++;
      exportPending.current = false;
      copyPending.current = false;
      setCopyFeedback(null);
      setExportFeedback(null);
      setExporting(false);
      setCopying(false);
      return () => {
        scope.current++;
      };
    }, [serialized, payload.kind]);

    async function copyPayload(): Promise<void> {
      if (copyPending.current) return;
      const current = scope.current;
      copyPending.current = true;
      setCopying(true);
      setCopyFeedback(null);
      const error = await copyTextToClipboard(serialized);
      if (current === scope.current) {
        setCopyFeedback(error ?? 'Payload copied.');
        copyPending.current = false;
        setCopying(false);
      }
    }

    async function exportPayload(): Promise<void> {
      if (exportPending.current) return;
      const current = scope.current;
      exportPending.current = true;
      setExporting(true);
      setExportFeedback(null);
      try {
        await onExport();
      } catch (error) {
        if (current === scope.current)
          setExportFeedback(error instanceof Error ? error.message : 'Export failed. Try saving the example again.');
      } finally {
        if (current === scope.current) {
          exportPending.current = false;
          setExporting(false);
        }
      }
    }

    return (
      <section aria-label="Example payload" className="border-t border-border px-panel-x py-panel-y">
        <header className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{title}</h3>
          <div className="flex gap-1.5">
            <Button type="button" variant="ghost" size="xs" disabled={copying} onClick={() => void copyPayload()}>
              {copying ? 'Copying…' : 'Copy'}
            </Button>
            <Button type="button" variant="ghost" size="xs" disabled={exporting} onClick={() => void exportPayload()}>
              {exporting ? 'Exporting…' : 'Export'}
            </Button>
          </div>
        </header>
        <pre
          tabIndex={0}
          aria-label={`${title} JSON`}
          className="studio-scroll mt-2 max-h-56 overflow-auto text-2xs leading-5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          data-testid="instance-payload-output"
        >
          {serialized}
        </pre>
        {copyFeedback ? (
          <p role="status" className="mt-1 wrap-anywhere text-2xs text-muted-foreground">
            {copyFeedback}
          </p>
        ) : null}
        {exportFeedback ? (
          <p role="alert" className="mt-1 wrap-anywhere text-2xs text-destructive">
            {exportFeedback}
          </p>
        ) : null}
      </section>
    );
  },
  { op: 'InstancePayloadPanel' }
);
