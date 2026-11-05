// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import type { ReactNode } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@rune-langium/design-system/ui/resizable';
import { Button } from '@rune-langium/design-system/ui/button';
import { withInstrumentation } from '../../services/instrumentation/core.js';

export const ExportWorkspacePanel = withInstrumentation(
  function ExportWorkspacePanel({
    settings,
    output,
    expanded,
    onToggleExpanded,
    notice
  }: {
    settings: ReactNode;
    output: ReactNode;
    expanded: boolean;
    onToggleExpanded(): void;
    notice?: string;
  }) {
    return (
      <div className="flex h-full min-h-0 flex-col" data-testid="export-workspace">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-2 py-1">
          <span className="text-xs font-medium">Export</span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={expanded ? 'Restore export panel' : 'Expand export panel'}
            title={expanded ? 'Restore export panel' : 'Expand export panel'}
            onClick={onToggleExpanded}
          >
            {expanded ? (
              <Minimize2 className="size-3.5" aria-hidden="true" />
            ) : (
              <Maximize2 className="size-3.5" aria-hidden="true" />
            )}
          </Button>
        </div>
        {notice && (
          <p role="status" className="shrink-0 px-3 py-1 text-xs text-muted-foreground">
            {notice}
          </p>
        )}
        <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
          <ResizablePanel id="export-settings-pane" defaultSize="300px" minSize="160px">
            <section aria-label="Export settings" className="h-full min-h-0">
              {settings}
            </section>
          </ResizablePanel>
          <ResizableHandle
            aria-label="Resize export settings and output"
            className="h-2 w-full bg-transparent hover:bg-border focus-visible:bg-border"
          />
          <ResizablePanel id="export-output-pane" minSize="25%">
            <section aria-label="Generated output" className="flex h-full min-h-0 flex-col border-t border-border">
              <h2 className="shrink-0 border-b border-border bg-muted/30 px-3 py-2 text-sm font-semibold">
                Generated output
              </h2>
              <div className="min-h-0 flex-1">{output}</div>
            </section>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    );
  },
  {
    op: 'ExportWorkspacePanel',
    sanitize: () => undefined,
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);
