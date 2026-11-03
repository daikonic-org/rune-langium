// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { CircleHelp } from 'lucide-react';
import { withInstrumentation } from '../services/instrumentation/core.js';
import { Popover, PopoverContent, PopoverTrigger } from '@rune-langium/design-system/ui/popover';

/** Point-of-need workbench guidance; opening help never changes the active task. */
export const StudioHelp = withInstrumentation(
  function StudioHelp() {
    return (
      <Popover>
        <PopoverTrigger
          render={<button type="button" className="studio-rail__btn" aria-label="Studio help" title="Studio help" />}
        >
          <CircleHelp className="size-4" aria-hidden="true" />
        </PopoverTrigger>
        <PopoverContent
          aria-label="Studio help"
          align="start"
          className="studio-scroll max-h-[80vh] overflow-auto space-y-3"
        >
          <h2 className="text-sm font-semibold">Studio help</h2>
          <dl className="space-y-3 text-xs">
            <div>
              <dt className="font-medium">Find and read a declaration</dt>
              <dd className="mt-1 text-muted-foreground">
                Use Search or the Type explorer. Source and Inspector can open alongside Structure or Graph. Focus a
                pane to read it alone; Restore panes returns to your arrangement.
              </dd>
            </div>
            <div>
              <dt className="font-medium">Make room</dt>
              <dd className="mt-1 text-muted-foreground">
                The Preview panel collapses when the center needs space. Show Preview panel reopens it. Focus preview
                expands generated code; Restore preview layout returns. Your drafts stay in place.
              </dd>
            </div>
            <div>
              <dt className="font-medium">Add reference models</dt>
              <dd className="mt-1 text-muted-foreground">
                Open Workspaces → Reference models. Choose a release and review its dependencies before saving.
                Reference declarations remain read-only.
              </dd>
            </div>
            <div>
              <dt className="font-medium">Try sample data</dt>
              <dd className="mt-1 text-muted-foreground">
                In Prototype, import Reference examples into the library, then select an example to bind it. Validation
                checks the input; Execute runs the selected function separately. Open an issue to find its field and
                details.
              </dd>
            </div>
            <div>
              <dt className="font-medium">Import or generate a model</dt>
              <dd className="mt-1 text-muted-foreground">
                Import Model previews a schema before you add it to the workspace. Export / Packaging selects
                declarations and generates artifacts. In Code, choose a target to view or download its output.
              </dd>
            </div>
            <div>
              <dt className="font-medium">Larger text and keyboard access</dt>
              <dd className="mt-1 text-muted-foreground">
                Settings → Appearance changes pane font size and theme. Search opens with ⌘K or Ctrl+K. Tab moves
                between controls; Escape closes help and restores a focused center pane.
              </dd>
            </div>
          </dl>
        </PopoverContent>
      </Popover>
    );
  },
  { op: 'StudioHelp', sanitize: () => ({}) }
);
