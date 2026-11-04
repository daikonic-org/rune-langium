// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { useEffect, useRef, useState } from 'react';
import { Button } from '@rune-langium/design-system/ui/button';
import type { WorkspaceSaveState } from '../../services/workspace-autosave.js';
import { withInstrumentation } from '../../services/instrumentation/core.js';

/** Source persistence is separate from the file's uncommitted Git modification flag. */
export const SourceSaveControl = withInstrumentation(
  function SourceSaveControl({ state, save }: { state?: WorkspaceSaveState; save(): Promise<void> }) {
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string>();
    const sequence = useRef(0);
    useEffect(
      () => () => {
        sequence.current++;
      },
      []
    );
    const saving = pending || state === 'saving';
    const label =
      error || state === 'error'
        ? 'Save failed'
        : saving
          ? 'Saving…'
          : state === 'pending'
            ? 'Unsaved changes'
            : state === 'saved'
              ? 'Saved locally'
              : 'Autosave on';
    return (
      <>
        <span
          role={error || state === 'error' ? 'alert' : 'status'}
          className="shrink-0 whitespace-nowrap"
          title={error ?? 'Local save status. Commit and push are separate actions.'}
        >
          {label}
        </span>
        <Button
          variant="ghost"
          size="xs"
          disabled={saving}
          aria-label="Save source"
          onClick={async () => {
            const request = ++sequence.current;
            setPending(true);
            setError(undefined);
            try {
              await save();
            } catch (error) {
              if (sequence.current === request) setError(error instanceof Error ? error.message : String(error));
            } finally {
              if (sequence.current === request) setPending(false);
            }
          }}
        >
          Save
        </Button>
      </>
    );
  },
  { op: 'SourceSaveControl' }
);
