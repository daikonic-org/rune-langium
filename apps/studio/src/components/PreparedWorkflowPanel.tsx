// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { useState } from 'react';
import { Button } from '@rune-langium/design-system/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@rune-langium/design-system/ui/dialog';
import { SourceEditor } from './SourceEditor.js';
import type { PreparedWorkflowData } from '../services/prepared-workflow.js';
import { withInstrumentation } from '../services/instrumentation/core.js';

export const PreparedWorkflowPanel = withInstrumentation(
  function PreparedWorkflowPanel({
    data,
    saving,
    error,
    onSave
  }: {
    data: PreparedWorkflowData;
    saving: boolean;
    error?: string;
    onSave(): Promise<void>;
  }) {
    const [open, setOpen] = useState(false);
    const files = Object.entries(data.sources).map(([path, content]) => ({
      path,
      content,
      name: path.split('/').at(-1) ?? path,
      dirty: false,
      readOnly: true
    }));
    return (
      <>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span role="status">
            Data prepared · {data.receipt.queryCount} {data.receipt.queryCount === 1 ? 'query' : 'queries'}
          </span>
          <Button variant="outline" size="xs" onClick={() => setOpen(true)}>
            Review prepared data
          </Button>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Prepared provider sources</DialogTitle>
              <DialogDescription>
                These sources apply to this calculation. Save them to reuse the prepared data offline.
              </DialogDescription>
            </DialogHeader>
            <div className="h-72 min-h-0 overflow-hidden rounded-md border">
              <SourceEditor files={files} />
            </div>
            <p className="text-xs text-muted-foreground">
              {files.length} {files.length === 1 ? 'source file' : 'source files'} and an execution receipt will be
              saved.
            </p>
            {error ? (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end">
              <Button size="sm" disabled={saving} onClick={() => void onSave()}>
                {saving ? 'Saving…' : 'Save prepared data'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  },
  { op: 'PreparedWorkflowPanel', capture: 0 }
);
