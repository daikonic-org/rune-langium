// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { useId, useState } from 'react';
import { Button } from '@rune-langium/design-system/ui/button';
import { Checkbox } from '@rune-langium/design-system/ui/checkbox';
import { Field, FieldContent, FieldDescription, FieldLabel } from '@rune-langium/design-system/ui/field';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@rune-langium/design-system/ui/dialog';
import { useWorkspaceOptional } from '../shell/providers/workspace-context.js';
import { downloadStudioDebugReport } from '../services/debug-report.js';
import { withInstrumentation } from '../services/instrumentation/core.js';

export const DebugReportDialog = withInstrumentation(
  function DebugReportDialog({ onClose }: { onClose(): void }) {
    const workspace = useWorkspaceOptional();
    const [includeSource, setIncludeSource] = useState(false);
    const includeSourceId = useId();
    const sourceHelpId = useId();
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Export debug info</DialogTitle>
            <DialogDescription>
              Download workspace details, diagnostics, recent logs and environment settings as a local JSON file.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Nothing is uploaded. Logs and file names may contain private information; review the file before sharing.
          </p>
          <Field orientation="horizontal">
            <Checkbox
              id={includeSourceId}
              aria-describedby={sourceHelpId}
              checked={includeSource}
              onCheckedChange={setIncludeSource}
            />
            <FieldContent>
              <FieldLabel htmlFor={includeSourceId}>Include available workspace source</FieldLabel>
              <FieldDescription id={sourceHelpId}>
                Source is excluded by default. Unloaded curated files are not fetched.
              </FieldDescription>
            </FieldContent>
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                downloadStudioDebugReport(workspace, { includeSource });
                onClose();
              }}
            >
              Download report
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  },
  { op: 'DebugReportDialog' }
);
