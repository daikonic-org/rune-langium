// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import type { ReactNode } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@rune-langium/design-system/ui/tabs';
import { Button } from '@rune-langium/design-system/ui/button';
import { withInstrumentation } from '../../services/instrumentation/core.js';

export const ExportWorkspacePanel = withInstrumentation(
  function ExportWorkspacePanel({
    view,
    onViewChange,
    settings,
    output,
    expanded,
    onToggleExpanded,
    notice
  }: {
    view: 'settings' | 'output';
    onViewChange(view: 'settings' | 'output'): void;
    settings: ReactNode;
    output: ReactNode;
    expanded: boolean;
    onToggleExpanded(): void;
    notice?: string;
  }) {
    return (
      <Tabs
        value={view}
        onValueChange={(value) => onViewChange(value as 'settings' | 'output')}
        className="flex h-full min-h-0 flex-col gap-0"
        data-testid="export-workspace"
      >
        <div className="flex shrink-0 items-center border-b border-border px-2">
          <TabsList size="sm" aria-label="Export workspace" className="flex-1">
            <TabsTrigger value="settings">Settings</TabsTrigger>
            <TabsTrigger value="output">Generated output</TabsTrigger>
          </TabsList>
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
        <TabsContent
          value="settings"
          keepMounted
          className="mt-0 min-h-0 flex-1"
          style={{ display: view === 'settings' ? 'block' : 'none' }}
        >
          {settings}
        </TabsContent>
        <TabsContent
          value="output"
          keepMounted
          className="mt-0 min-h-0 flex-1"
          style={{ display: view === 'output' ? 'block' : 'none' }}
        >
          {output}
        </TabsContent>
      </Tabs>
    );
  },
  {
    op: 'ExportWorkspacePanel',
    sanitize: () => undefined,
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);
