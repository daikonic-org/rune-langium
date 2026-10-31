// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { useState } from 'react';
import { parseExpression, type ExpressionRegion } from '@rune-langium/core';
import { ExpressionBuilder, type FunctionScope } from '@rune-langium/visual-editor';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@rune-langium/design-system/ui/dialog';
import { Button } from '@rune-langium/design-system/ui/button';
import type { DocumentBinding, DocumentEdit, CommitResult } from '../../services/expression-document.js';
import { SourceEditor } from '../SourceEditor.js';
import { withInstrumentation } from '../../services/instrumentation/core.js';

export interface ExpressionBuilderDialogProps {
  binding: DocumentBinding;
  target: ExpressionRegion;
  scope: FunctionScope;
  onApply(edit: DocumentEdit): CommitResult;
  onClose(): void;
}

/** A mounted dialog owns one captured revision and a private draft. */
export const ExpressionBuilderDialog = withInstrumentation(
  function ExpressionBuilderDialog({ binding, target, scope, onApply, onClose }: ExpressionBuilderDialogProps) {
    const expectedText = binding.source.slice(target.region.from, target.region.to);
    const [draft, setDraft] = useState(expectedText);
    const [error, setError] = useState<string>();
    const apply = () => {
      if (binding.readOnly) return;
      const parsed = parseExpression(draft);
      if (parsed.hasErrors) {
        setError('Invalid Rune expression. Correct the draft before applying.');
        return;
      }
      const result = onApply({ binding, region: target.region, expectedText, replacement: draft });
      if (result.ok) onClose();
      else
        setError(
          result.reason === 'read-only'
            ? 'This source is read-only.'
            : 'The source changed. Reopen the builder to apply this draft.'
        );
    };
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DialogContent
          className="w-[calc(100vw-32px)] max-w-[1120px] max-h-[calc(100dvh-32px)] gap-3 overflow-auto p-4"
          showCloseButton={false}
        >
          <DialogTitle className="text-sm">Expression builder</DialogTitle>
          <DialogDescription className="text-xs">
            {target.kind} {target.index + 1} · Changes stay in this draft until Apply.
          </DialogDescription>
          <ExpressionBuilder
            value={draft}
            onChange={setDraft}
            onBlur={() => {}}
            scope={scope}
            renderTextEditor={({ value, onChange, onBlur }) => (
              <div className="expression-code-editor min-w-0" data-testid="text-editor" onBlur={onBlur}>
                <SourceEditor
                  hideTabs
                  activeFile="/builder-draft.rosetta"
                  files={[
                    {
                      name: 'Expression draft',
                      path: '/builder-draft.rosetta',
                      content: value,
                      dirty: false,
                      readOnly: binding.readOnly
                    }
                  ]}
                  onContentChange={(_, text) => onChange(text)}
                />
              </div>
            )}
          />
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" disabled={binding.readOnly} onClick={apply}>
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  },
  { op: 'ExpressionBuilderDialog' }
);
